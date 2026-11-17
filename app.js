/* IronmanCoach PWA : écrans « Aujourd'hui » et « Planning ».
 * Lit le snapshot envoyé par le PC (table mobile_snapshots) et envoie les
 * déplacements de séance au PC (table mobile_commands, type move_session).
 * Aucun HTML n'est construit à partir des données : tout passe par h().
 */
(() => {
  "use strict";

  // ------------------------------------------------------------------ config
  const CFG = window.IC_CONFIG || {};
  const BASE = String(CFG.supabaseUrl || "").trim().replace(/\/+$/, "");
  const KEY = String(CFG.supabaseKey || "").trim();
  // https obligatoire ; http accepté seulement en local (tests).
  const CONFIGURED = /^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(BASE) && KEY.length > 0;

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };
  const K = { session: "ic.session", snap: "ic.snapshot", view: "ic.view", demo: "ic.demo" };

  const state = {
    session: store.get(K.session),
    demo: !!store.get(K.demo) || new URLSearchParams(location.search).has("demo"),
    snap: null,          // payload du PC
    snapAt: null,        // updated_at de la ligne Supabase
    commands: [],        // commandes récentes du téléphone
    offline: false,
    loadedAt: 0,
    view: location.hash === "#planning" ? "planning" : location.hash === "#today" ? "today"
      : store.get(K.view) === "planning" ? "planning" : "today",
    weekOffset: 0,
    open: new Set(),     // séances dépliées
  };

  // --------------------------------------------------------------- utilitaires
  const $ = (s) => document.querySelector(s);
  const app = $("#app");

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style") el.style.cssText = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false || c === "") continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  // Icônes : chaînes constantes (jamais de données utilisateur).
  const ICONS = {
    swim: '<path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 13.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5"/><circle cx="16.5" cy="5.5" r="2"/><path d="M6 10l4-4 3 3"/>',
    bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5l4-7h6l3 7M9.5 9.5L12 16.5h-6.5M14 6h3"/>',
    run: '<circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M6.5 12l2.5-4 4 1 3 3 3 1M11 15l-1.5-3"/>',
    str: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>',
  };
  function icon(name) {
    const t = document.createElement("template");
    t.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
    return t.content.firstChild;
  }

  const num = (v) => (v === null || v === undefined || v === "" || !isFinite(+v) ? null : +v);
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => isoOf(new Date());
  function parseISO(s) {
    const [y, m, d] = String(s || "").slice(0, 10).split("-").map(Number);
    return y ? new Date(y, m - 1, d, 12) : null;
  }
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  function mondayOf(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

  const fmtLongDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const fmtDayShort = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "short" });
  const fmtDM = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
  const fmtDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const fmtDec = (v, d = 0) => (num(v) == null ? "—" : (+v).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 }));

  function relTime(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return "date inconnue";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "à l'instant";
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    const d = Math.round(s / 86400);
    return d === 1 ? "hier" : `il y a ${d} jours`;
  }

  function fmtSec(sec) {
    sec = Math.round(+sec);
    if (!isFinite(sec) || sec <= 0) return "";
    if (sec < 60) return `${sec} s`;
    if (sec < 3600) { const m = Math.floor(sec / 60), r = sec % 60; return r ? `${m} min ${pad(r)}` : `${m} min`; }
    const hh = Math.floor(sec / 3600), mm = Math.round((sec % 3600) / 60);
    return mm ? `${hh} h ${pad(mm)}` : `${hh} h`;
  }
  const fmtMin = (min) => (num(min) == null ? "" : fmtSec(+min * 60));
  function fmtDist(m) {
    m = num(m);
    if (m == null || m <= 0) return "";
    return m >= 1000 ? `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
  }
  const fmtPace = (s) => { s = Math.round(s); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

  // ----------------------------------------------------------------- domaine
  function sportKey(s) {
    s = String(s || "").toLowerCase();
    if (/swim|natat|nage|piscine|eau libre/.test(s)) return "swim";
    if (/bike|v[ée]lo|cycl|home.?trainer|ride/.test(s)) return "bike";
    if (/run|course|cap\b|trail|footing/.test(s)) return "run";
    if (/^str|renfo|gainage|muscu|mobilit|yoga|core/.test(s)) return "str";
    return "other";
  }
  const SPORT_LABEL = { swim: "Natation", bike: "Vélo", run: "Course", str: "Renforcement", other: "Autre" };
  const INTENSITY_LABEL = { warmup: "Échauffement", cooldown: "Retour au calme", recovery: "Récupération", rest: "Repos" };

  // Photos d'ambiance (libres de droits, voir assets/photos/credits.json).
  const PHOTOS = {
    swim: [{ src: "assets/photos/swim.webp", pos: "50% 45%" }],
    bike: [{ src: "assets/photos/bike.webp", pos: "62% 55%" }, { src: "assets/photos/bike-group.webp", pos: "50% 55%" }],
    run: [{ src: "assets/photos/run.webp", pos: "72% 45%" }],
    str: [{ src: "assets/photos/strength.webp", pos: "38% 30%" }],
    rest: [{ src: "assets/photos/rest.webp", pos: "50% 55%" }],
  };
  function photoFor(key, seed = 0) {
    const list = PHOTOS[key];
    return list ? list[Math.abs(num(seed) || 0) % list.length] : null;
  }
  function photo(key, seed, cls, ...overlay) {
    const p = photoFor(key, seed);
    if (!p) return null;
    return h("div", { class: "photo " + (cls || "") },
      h("img", { src: p.src, alt: "", "aria-hidden": "true", loading: "lazy", decoding: "async", style: `object-position:${p.pos}` }),
      overlay.length ? h("div", { class: "photo-overlay" }, overlay) : null);
  }

  const isDone = (s) => num(s.feedback && s.feedback.completed) === 1 || /done|complet|r[ée]alis/i.test(s.status || "");
  const isCancelled = (s) => /cancel|annul|skip/i.test(s.status || "");

  function stepTarget(st, sport) {
    const lo = num(st.target_low), hi = num(st.target_high);
    const t = String(st.target_type || "open").toLowerCase();
    if (t === "open" || (lo == null && hi == null)) return "";
    const range = (f, unit) => {
      if (lo != null && lo > 0 && hi != null && hi > 0) return (lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`) + unit;
      if (hi != null && hi > 0) return `≤ ${f(hi)}${unit}`;
      return `≥ ${f(lo)}${unit}`;
    };
    if (t === "hr") return range(Math.round, " bpm");
    if (t === "power") return range(Math.round, " W");
    if (t === "pace") return range(fmtPace, sport === "swim" ? " /100 m" : " /km");
    if (t === "cadence") return range(Math.round, sport === "bike" ? " rpm" : " pas/min");
    if (t === "speed") return range((v) => fmtDec(v, 1), " km/h");
    return range((v) => fmtDec(v, 1), "");
  }
  function stepDuration(st) {
    const t = String(st.duration_type || "").toLowerCase();
    if (t === "time") return fmtMin(st.duration_value);
    if (t === "distance") return fmtDist(st.duration_value);
    if (t === "lap" || t === "open") return "au tour";
    return "";
  }

  // Séances avec les déplacements en attente appliqués.
  function pendingMoves() {
    const map = new Map();
    for (const c of state.commands) {
      if (c.command_type !== "move_session" || c.status !== "pending") continue;
      const sid = num(c.payload && c.payload.session_id);
      if (sid != null && !map.has(sid)) map.set(sid, c); // commandes triées de la plus récente à la plus ancienne
    }
    return map;
  }
  function sessions() {
    const moves = pendingMoves();
    const list = (state.snap && Array.isArray(state.snap.planning) ? state.snap.planning : []).map((s) => {
      const mv = moves.get(num(s.id));
      return mv ? { ...s, session_date: String(mv.payload.new_date).slice(0, 10), _pending: mv, _from: s.session_date } : s;
    });
    return list.sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)) || (num(a.id) || 0) - (num(b.id) || 0));
  }
  const sessionsOn = (iso) => sessions().filter((s) => String(s.session_date).slice(0, 10) === iso);
  function recentError(sid) {
    return state.commands.find((c) => c.command_type === "move_session" && c.status === "error"
      && num(c.payload && c.payload.session_id) === sid && Date.now() - Date.parse(c.processed_at || c.created_at) < 3 * 86400000
      && !(c.result && /annul/i.test(String(c.result.message || ""))));
  }

  // --------------------------------------------------------------- bannière
  let bannerTimer = null;
  function banner(text, kind = "warn", ms = 0) {
    const b = $("#banner");
    clearTimeout(bannerTimer);
    if (!text) { b.hidden = true; return; }
    b.textContent = text;
    b.className = "banner" + (kind === "warn" ? "" : " " + kind);
    b.hidden = false;
    if (ms) bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
  }

  // -------------------------------------------------------------- Supabase
  let refreshing = null;
  async function rawFetch(path, { method = "GET", body, headers = {}, token } = {}) {
    const hdr = { apikey: KEY, "Content-Type": "application/json", ...headers };
    if (token) hdr.Authorization = "Bearer " + token;
    let res;
    try {
      res = await fetch(BASE + path, { method, headers: hdr, body: body == null ? undefined : JSON.stringify(body), cache: "no-store" });
    } catch {
      const e = new Error("Connexion impossible : vérifiez le réseau."); e.network = true; throw e;
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `Erreur ${res.status}`;
      const e = new Error(msg); e.status = res.status; throw e;
    }
    return data;
  }

  function saveSession(data) {
    const user = data.user || {};
    state.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || (state.session && state.session.refresh_token),
      expires_at: Math.floor(Date.now() / 1000) + (num(data.expires_in) || 3600),
      user_id: user.id || (state.session && state.session.user_id),
      email: user.email || (state.session && state.session.email),
    };
    store.set(K.session, state.session);
  }

  async function signIn(email, password) {
    const data = await rawFetch("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
    if (!data || !data.access_token) throw new Error("Connexion refusée.");
    saveSession(data);
  }

  function refreshSession() {
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const data = await rawFetch("/auth/v1/token?grant_type=refresh_token",
            { method: "POST", body: { refresh_token: state.session.refresh_token } });
          saveSession(data);
        } catch (e) {
          if (!e.network) { signOut(false); throw new Error("Session expirée : reconnectez-vous."); }
          throw e;
        } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }

  async function api(path, opts = {}) {
    if (!state.session) throw new Error("Non connecté.");
    if ((state.session.expires_at || 0) - 60 < Date.now() / 1000) await refreshSession();
    try {
      return await rawFetch(path, { ...opts, token: state.session.access_token });
    } catch (e) {
      if (e.status !== 401) throw e;
      await refreshSession();
      return rawFetch(path, { ...opts, token: state.session.access_token });
    }
  }

  function signOut(rerender = true) {
    state.session = null; state.snap = null; state.commands = [];
    store.del(K.session); store.del(K.snap);
    if (rerender) render();
  }

  async function loadData({ silent = false } = {}) {
    if (state.demo) {
      if (!state.snap) state.snap = window.IC_DEMO.build();
      state.snapAt = state.snap.generated_at; state.loadedAt = Date.now();
      render(); return;
    }
    const btn = $("#btn-refresh");
    btn.classList.add("spinning");
    const uid = encodeURIComponent(state.session.user_id);
    try {
      const [rows, cmds] = await Promise.all([
        api(`/rest/v1/mobile_snapshots?select=payload,updated_at&user_id=eq.${uid}&limit=1`),
        api(`/rest/v1/mobile_commands?select=id,command_type,payload,status,result,created_at,processed_at&user_id=eq.${uid}&order=created_at.desc&limit=40`)
          .catch(() => state.commands),
      ]);
      const row = Array.isArray(rows) ? rows[0] : null;
      state.snap = row ? row.payload : null;
      state.snapAt = row ? row.updated_at : null;
      state.commands = Array.isArray(cmds) ? cmds : [];
      state.offline = false;
      state.loadedAt = Date.now();
      store.set(K.snap, { uid: state.session.user_id, snap: state.snap, at: state.snapAt, commands: state.commands });
      if (!silent) banner("");
    } catch (e) {
      if (!state.session) { banner(e.message, "error", 8000); render(); return; } // session expirée : retour à la connexion
      const cached = store.get(K.snap);
      if (!state.snap && cached && cached.uid === state.session.user_id) {
        state.snap = cached.snap; state.snapAt = cached.at; state.commands = cached.commands || [];
      }
      state.offline = !!e.network;
      banner(e.network ? "Hors ligne : affichage des dernières données reçues." : e.message, e.network ? "info" : "error");
    } finally {
      btn.classList.remove("spinning");
      state.loadedAt = Date.now();
    }
    render();
  }

  async function sendMove(session, newDate) {
    const sid = num(session.id);
    const payload = { session_id: sid, new_date: newDate };
    if (state.demo) {
      const s = state.snap.planning.find((x) => num(x.id) === sid);
      if (s) { s.user_moved_from_date = s.user_moved_from_date || s.session_date; s.session_date = newDate; s.user_moved = 1; }
      banner("Mode démo : séance déplacée (simulation).", "info", 4000);
      return;
    }
    const rows = await api("/rest/v1/mobile_commands", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: [{ user_id: state.session.user_id, command_type: "move_session", payload, status: "pending" }],
    });
    if (Array.isArray(rows) && rows[0]) state.commands.unshift(rows[0]);
    banner("Déplacement envoyé. Il sera appliqué à la prochaine synchronisation du PC (IronmanCoach ouvert).", "info", 7000);
  }

  async function cancelMove(cmd) {
    if (state.demo) return;
    await api(`/rest/v1/mobile_commands?id=eq.${encodeURIComponent(cmd.id)}&status=eq.pending`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { status: "error", result: { ok: false, message: "Annulé depuis le téléphone" }, processed_at: new Date().toISOString() },
    });
    cmd.status = "error"; cmd.result = { ok: false, message: "Annulé depuis le téléphone" };
    banner("Déplacement annulé.", "info", 4000);
  }

  // ---------------------------------------------------------------- rendus
  function render() {
    const logged = state.demo || !!state.session;
    $("#tabs").hidden = !logged;
    $("#btn-refresh").hidden = !logged;
    $("#btn-account").hidden = !logged;
    document.querySelectorAll(".tab").forEach((t) => {
      if (t.dataset.view === state.view) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    app.replaceChildren();
    if (!logged) { app.append(viewLogin()); return; }
    if (!state.snap) { app.append(state.loadedAt ? viewNoData() : h("p", { class: "loading" }, "Chargement…")); return; }
    app.append(state.view === "planning" ? viewPlanning() : viewToday());
  }

  function freshness() {
    const at = state.snapAt || (state.snap && state.snap.generated_at);
    const age = (Date.now() - Date.parse(at)) / 3600000;
    const text = state.demo ? "Mode démonstration : données fictives" : `Données du PC ${relTime(at)}`;
    return h("p", { class: "page-sub" }, text,
      !state.demo && age > 24 ? h("span", { class: "badge watch", style: "margin-left:6px" }, "à synchroniser") : null);
  }

  // ---- Connexion
  function viewLogin() {
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const email = h("input", { type: "email", name: "email", autocomplete: "username", required: true, inputmode: "email" });
    const pwd = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
    const submit = h("button", { class: "btn primary block", type: "submit", style: "margin-top:18px" }, "Se connecter");
    const form = h("form", {
      onsubmit: async (ev) => {
        ev.preventDefault();
        err.hidden = true; submit.disabled = true; submit.textContent = "Connexion…";
        try {
          await signIn(email.value.trim(), pwd.value);
          state.demo = false; store.del(K.demo);
          render(); loadData();
        } catch (e) {
          err.textContent = /invalid/i.test(e.message) ? "Adresse e-mail ou mot de passe incorrect." : e.message;
          err.hidden = false;
        } finally { submit.disabled = false; submit.textContent = "Se connecter"; }
      },
    },
    h("label", { class: "field" }, h("span", null, "Adresse e-mail"), email),
    h("label", { class: "field" }, h("span", null, "Mot de passe"), pwd),
    submit, err);

    const demoBtn = h("button", {
      class: "btn block", type: "button",
      onclick: () => { state.demo = true; store.set(K.demo, true); state.snap = null; loadData(); },
    }, "Essayer avec des données fictives");

    return h("section", { class: "login" },
      photo("swim", 0, "login-hero"),
      h("h1", null, "Bienvenue"),
      h("p", { class: "muted" }, "Vos séances et votre planning, synchronisés depuis IronmanCoach sur votre PC."),
      CONFIGURED ? form : h("div", { class: "card", style: "margin-top:16px" },
        h("strong", null, "Application pas encore reliée à Supabase."),
        h("p", { class: "muted small", style: "margin:6px 0 0" }, "Renseignez l'URL et la clé publique dans config.js (voir README).")),
      h("div", { class: "divider" }, "ou"),
      demoBtn,
      h("p", { class: "small", style: "text-align:center;margin-top:18px" },
        h("a", { href: "presentation/", style: "color:var(--accent);font-weight:700" }, "Découvrir l'application →")));
  }

  function viewNoData() {
    return h("section", { class: "card empty" }, icon("cloud"),
      h("h2", null, "Aucune donnée reçue du PC"),
      h("p", { class: "muted" }, "Sur le PC, ouvrez IronmanCoach, bouton « Mobile / iPhone », puis connectez-vous avec le même compte ("
        + (state.session && state.session.email || "") + "). La synchronisation se fait ensuite toute seule."),
      h("button", { class: "btn primary", type: "button", onclick: () => loadData() }, "Réessayer"));
  }

  // ---- Aujourd'hui
  function viewToday() {
    const snap = state.snap, t = snap.today || {};
    const iso = todayIso();
    const today = sessionsOn(iso).filter((s) => !isCancelled(s));
    const name = String((snap.profile && snap.profile.name) || "").split(/\s+/)[0];
    const root = h("section", null,
      h("h1", { class: "page-title" }, cap(fmtLongDay.format(new Date()))),
      freshness());

    // Objectif
    const goals = (Array.isArray(snap.goals) ? snap.goals : [t.next_goal]).filter((g) => g && g.race_date >= iso);
    const g = goals[0];
    if (g) {
      const d = daysBetween(iso, g.race_date);
      root.append(h("div", { class: "card goal" },
        h("div", { class: "goal-count" }, d === 0 ? "J" : `J-${d}`, h("small", null, d >= 14 ? `${Math.floor(d / 7)} sem.` : "jours")),
        h("div", null,
          h("div", { class: "goal-name" }, g.name || "Objectif"),
          h("div", { class: "muted small" }, [cap(fmtDate.format(parseISO(g.race_date))), g.race_type].filter(Boolean).join(" • ")))));
    }

    root.append(h("h2", { class: "section-title" }, name ? `Séances du jour, ${name}` : "Séances du jour"));
    if (today.length) {
      today.forEach((s) => root.append(sessionCard(s, true, true)));
    } else {
      const next = sessions().find((s) => s.session_date > iso && !isCancelled(s));
      root.append(h("div", { class: "card rest-card" },
        photo("rest", 0, "rest-photo",
          h("strong", { class: "overlay-title" }, "Repos aujourd'hui"),
          h("span", { class: "overlay-sub" }, "La récupération fait partie du plan.")),
        next ? h("p", { class: "rest-next" }, h("span", { class: "label" }, "Prochaine séance "), h("br"),
          `${cap(fmtDayShort.format(parseISO(next.session_date)))} — ${next.title || SPORT_LABEL[sportKey(next.sport)]}`) : null));
    }

    root.append(loadSection(t), recoverySection(t));
    return root;
  }

  function metric(label, value, unit, ind) {
    return h("div", { class: "card metric" },
      h("span", { class: "label" }, label),
      h("div", { class: "metric-value" + (/[a-z]/i.test(value) ? " text" : "") }, value, unit && value !== "—" ? h("small", null, " " + unit) : null),
      ind ? h("span", { class: "badge " + (ind.level || "neutral") }, ind.label || "") : null,
      ind && ind.limit ? h("div", { class: "metric-limit" }, ind.limit) : null);
  }

  function loadSection(t) {
    const ls = t.load_summary || {};
    const lim = (t.indicator_limits && t.indicator_limits.load) || {};
    const change = num(ls.load_7d_change_pct);
    const sec = h("div", null, h("h2", { class: "section-title" }, "Charge d'entraînement"));
    sec.append(h("div", { class: "grid2" },
      metric("Forme (CTL)", fmtDec(ls.ctl, 1), "", lim.ctl),
      metric("Fraîcheur (TSB)", fmtDec(ls.tsb, 1), "", lim.tsb),
      metric("Ratio ATL/CTL", fmtDec(ls.atl_ctl_ratio, 2), "", lim.atl_ctl),
      metric("Charge 7 jours", fmtDec(ls.load_7d), change != null ? `(${change > 0 ? "+" : ""}${fmtDec(change)} %)` : "", lim.load_7d)));
    if (num(ls.planned_load_7d) != null) {
      const n = num(ls.planned_sessions_7d);
      sec.append(h("p", { class: "muted small" }, `Charge prévue sur 7 jours : ${fmtDec(ls.planned_load_7d)}`
        + (n != null ? ` (${fmtDec(n)} séance${n > 1 ? "s" : ""}).` : ".")));
    }
    if (ls.is_current === false) sec.append(h("p", { class: "muted small" }, "Pas encore de charge calculée pour aujourd'hui."));
    return sec;
  }

  function pick(obj, keys) { for (const k of keys) { if (obj && num(obj[k]) != null) return obj[k]; } return null; }

  function recoverySection(t) {
    const r = t.recovery || {};
    const cur = r.is_current !== false;
    const lim = (t.indicator_limits && t.indicator_limits.recovery) || {};
    const w = t.wellness || {};
    const fb = t.latest_feedback || {};
    const subj = [num(w.fatigue) != null ? `fatigue ${w.fatigue}/10` : null,
      num(fb.pain) != null ? `douleur ${fb.pain}/10` : null].filter(Boolean).join(" • ");
    const sec = h("div", null, h("h2", { class: "section-title" }, "Récupération"));
    sec.append(h("div", { class: "grid2" },
      metric("FC repos", cur ? fmtDec(pick(r, ["resting_hr"])) : "—", "bpm", lim.resting_hr),
      metric("VFC", cur ? fmtDec(pick(r, ["hrv_ms", "hrv", "hrv_last_night", "avg_hrv"])) : "—", "ms", lim.hrv),
      metric("Disponibilité", cur ? fmtDec(pick(r, ["training_readiness"])) : "—", "/100", lim.training_readiness),
      metric("Ressenti", subj || "—", "", lim.subjective)));
    const wt = t.latest_weight;
    if (wt && num(wt.weight_kg) != null) {
      sec.append(h("p", { class: "muted small" }, `Poids : ${fmtDec(wt.weight_kg, 1)} kg (${fmtDM.format(parseISO(wt.measurement_date))}).`));
    }
    if (!cur) sec.append(h("p", { class: "muted small" }, "Pas de données Garmin du jour pour l'instant."));
    return sec;
  }

  // ---- Carte séance
  function sessionCard(s, startOpen = false, withCover = false) {
    const sid = num(s.id);
    const sk = sportKey(s.sport);
    const key = String(sid);
    const isOpen = state.open.has(key) || (startOpen && !state.open.has("closed:" + key));
    const done = isDone(s);
    const err = recentError(sid);

    const badges = [];
    if (done) badges.push(h("span", { class: "badge good" }, "✓ Réalisée"));
    if (isCancelled(s)) badges.push(h("span", { class: "badge" }, "Annulée"));
    if (s._pending) badges.push(h("span", { class: "badge watch" }, `Déplacement en attente (était le ${fmtDM.format(parseISO(s._from))})`));
    else if (num(s.user_moved) === 1) badges.push(h("span", { class: "badge" }, "Déplacée"));
    if (String(s.priority || "").toUpperCase() === "A") badges.push(h("span", { class: "badge accent" }, "Séance clé"));
    if (num(s.optional) === 1) badges.push(h("span", { class: "badge" }, "Facultative"));
    if (err) badges.push(h("span", { class: "badge bad" }, "Déplacement refusé"));

    const meta = [SPORT_LABEL[sk], fmtMin(s.duration_min)].filter(Boolean);
    const card = h("article", { class: `card session sport-${sk}` + (withCover ? " with-cover" : ""), "open-detail": isOpen || null });
    if (withCover) {
      const cover = photo(sk, sid, "cover", h("span", { class: "cover-chip" }, SPORT_LABEL[sk]),
        num(s.duration_min) ? h("span", { class: "cover-dur" }, fmtMin(s.duration_min)) : null);
      if (cover) card.append(cover);
    }
    const head = h("button", {
      class: "session-head", type: "button", "aria-expanded": String(isOpen),
      onclick: () => {
        if (isOpen) { state.open.delete(key); state.open.add("closed:" + key); }
        else { state.open.add(key); state.open.delete("closed:" + key); }
        render();
      },
    },
    h("span", { class: "sport-icon" }, icon(sk)),
    h("span", { class: "session-main" },
      h("p", { class: "session-title" }, s.title || SPORT_LABEL[sk]),
      h("span", { class: "session-meta" }, meta.map((m) => h("span", null, m))),
      badges.length ? h("span", { class: "badges" }, badges) : null),
    h("span", { class: "chevron" }, icon("chevron")));
    card.append(head);
    if (isOpen) card.append(sessionDetail(s, sk, err));
    return card;
  }

  function sessionDetail(s, sk, err) {
    const d = h("div", { class: "session-detail" });
    if (s.objective) d.append(h("p", null, h("span", { class: "label" }, "Objectif "), h("br"), s.objective));
    const steps = Array.isArray(s.steps) ? s.steps.slice().sort((a, b) => (num(a.step_order) || 0) - (num(b.step_order) || 0)) : [];
    if (steps.length) {
      d.append(h("ul", { class: "steps" }, steps.map((st) => {
        const reps = num(st.repetitions) || 1;
        const dur = stepDuration(st);
        const rec = num(st.recovery_s) > 0 ? `récup ${fmtSec(st.recovery_s)}` : "";
        const tgt = stepTarget(st, sk);
        const intensity = String(st.intensity || "active").toLowerCase();
        const nm = st.step_name || INTENSITY_LABEL[intensity] || "Bloc";
        return h("li", { class: "step " + intensity },
          h("span", { class: "step-bar" }),
          h("div", null,
            h("div", { class: "step-name" }, nm),
            h("div", { class: "step-line" },
              dur ? h("span", null, reps > 1 ? `${reps} × ${dur}` : dur) : (reps > 1 ? h("span", null, `${reps} fois`) : null),
              tgt ? h("span", { class: "step-target" }, tgt) : null,
              rec && reps > 1 ? h("span", { class: "muted" }, rec) : null),
            st.notes ? h("div", { class: "step-notes" }, st.notes) : null));
      })));
    }
    if (s.notes) d.append(h("p", { class: "small" }, h("span", { class: "label" }, "Consignes "), h("br"), s.notes));
    if (s.nutrition) d.append(h("p", { class: "small" }, h("span", { class: "label" }, "Nutrition "), h("br"), s.nutrition));
    if (err) d.append(h("p", { class: "error-text" }, "Le PC a refusé le dernier déplacement : " + ((err.result && err.result.message) || "erreur inconnue")));

    if (!isDone(s) && !isCancelled(s) && s.session_date >= todayIso()) {
      const actions = h("div", { class: "actions" });
      if (s._pending) {
        actions.append(h("button", {
          class: "btn", type: "button",
          onclick: async (ev) => {
            ev.currentTarget.disabled = true;
            try { await cancelMove(s._pending); } catch (e) { banner(e.message, "error"); }
            render();
          },
        }, "Annuler le déplacement"));
      } else {
        actions.append(h("button", { class: "btn primary", type: "button", onclick: () => openMoveSheet(s) }, "Déplacer"));
      }
      d.append(actions);
    }
    return d;
  }

  // ---- Feuille « Déplacer »
  function openMoveSheet(s) {
    const dlg = $("#sheet"), body = $("#sheet-body");
    const win = (state.snap && state.snap.planning_window) || {};
    const min = todayIso();
    const max = win.end && win.end > min ? String(win.end).slice(0, 10) : isoOf(addDays(new Date(), 60));
    const input = h("input", { type: "date", value: s.session_date, min, max, required: true });
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const quick = h("div", { class: "badges" });
    const base = parseISO(s.session_date);
    [-2, -1, 1, 2].forEach((n) => {
      const d = isoOf(addDays(base, n));
      if (d < min || d > max) return;
      quick.append(h("button", { type: "button", class: "btn", style: "min-height:36px;padding:0 10px;font-size:14px",
        onclick: () => { input.value = d; } }, cap(fmtDayShort.format(parseISO(d)))));
    });
    const ok = h("button", { class: "btn primary", type: "submit" }, "Déplacer");
    const form = h("form", {
      method: "dialog",
      onsubmit: async (ev) => {
        ev.preventDefault();
        const v = input.value;
        err.hidden = true;
        if (!v || v < min || v > max) { err.textContent = "Choisissez une date entre aujourd'hui et la fin du planning."; err.hidden = false; return; }
        if (v === s.session_date) { dlg.close(); return; }
        ok.disabled = true; ok.textContent = "Envoi…";
        try { await sendMove(s, v); dlg.close(); render(); }
        catch (e) { err.textContent = e.message; err.hidden = false; }
        finally { ok.disabled = false; ok.textContent = "Déplacer"; }
      },
    },
    h("h2", { id: "sheet-title" }, "Déplacer la séance"),
    h("p", { class: "muted" }, `${s.title || ""} — actuellement ${fmtDayShort.format(base)}`),
    quick,
    h("label", { class: "field" }, h("span", null, "Nouvelle date"), input),
    h("p", { class: "muted small" }, state.demo ? "Mode démo : le déplacement est simulé."
      : "Le PC appliquera le déplacement à sa prochaine synchronisation. Le Coach garde la main sur le contenu de la séance."),
    err,
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Annuler"), ok));
    body.replaceChildren(form);
    dlg.showModal();
  }

  function openAccountSheet() {
    const dlg = $("#sheet"), body = $("#sheet-body");
    const at = state.snapAt || (state.snap && state.snap.generated_at);
    body.replaceChildren(
      h("h2", { id: "sheet-title" }, "Compte"),
      h("p", { class: "muted" }, state.demo ? "Mode démonstration (données fictives)." : (state.session && state.session.email) || ""),
      at ? h("p", { class: "small" }, `Dernières données du PC : ${relTime(at)}.`) : null,
      state.snap && state.snap.app_version ? h("p", { class: "small muted" }, `IronmanCoach ${state.snap.app_version}`) : null,
      h("p", { class: "small" }, h("a", { href: "presentation/", class: "link" }, "Présentation de l'application"),
        " · ", h("button", { type: "button", class: "link", onclick: openCredits }, "Crédits photos")),
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Fermer"),
        h("button", {
          class: "btn primary", type: "button",
          onclick: () => {
            dlg.close();
            if (state.demo) { state.demo = false; store.del(K.demo); state.snap = null; history.replaceState(null, "", location.pathname); render(); }
            else signOut();
          },
        }, state.demo ? "Quitter la démo" : "Se déconnecter")));
    dlg.showModal();
  }

  async function openCredits() {
    const body = $("#sheet-body");
    const list = h("ul", { class: "credits" }, h("li", { class: "muted" }, "Chargement…"));
    body.replaceChildren(h("h2", { id: "sheet-title" }, "Crédits photos"),
      h("p", { class: "muted small" }, "Photos libres de droits issues de Wikimedia Commons."), list,
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => $("#sheet").close() }, "Fermer")));
    try {
      const res = await fetch("assets/photos/credits.json");
      const items = await res.json();
      list.replaceChildren(...items.map((c) => h("li", null,
        h("strong", null, ({ swim: "Natation", bike: "Vélo", "bike-group": "Vélo (groupe)", run: "Course", strength: "Renforcement", rest: "Repos" })[String(c.file).split("/").pop().replace(".webp", "")] || "Photo"),
        " — ", c.author || "Auteur inconnu",
        h("br"), h("span", { class: "muted" }, c.license || ""), " · ",
        /^https:\/\/commons\.wikimedia\.org\//.test(c.source) ? h("a", { href: c.source, target: "_blank", rel: "noopener", class: "link" }, "source") : null)));
    } catch { list.replaceChildren(h("li", { class: "muted" }, "Crédits indisponibles hors ligne.")); }
  }

  // ---- Planning
  function viewPlanning() {
    const all = sessions();
    const win = state.snap.planning_window || {};
    const first = win.start || (all[0] && all[0].session_date) || todayIso();
    const last = win.end || (all.length && all[all.length - 1].session_date) || todayIso();
    const thisMonday = mondayOf(new Date());
    const minOff = Math.min(0, Math.floor(daysBetween(isoOf(thisMonday), isoOf(mondayOf(parseISO(first)))) / 7));
    const maxOff = Math.max(0, Math.floor(daysBetween(isoOf(thisMonday), isoOf(mondayOf(parseISO(last)))) / 7));
    state.weekOffset = Math.min(maxOff, Math.max(minOff, state.weekOffset));

    const monday = addDays(thisMonday, state.weekOffset * 7);
    const sunday = addDays(monday, 6);
    const days = Array.from({ length: 7 }, (_, i) => isoOf(addDays(monday, i)));
    const week = all.filter((s) => days.includes(String(s.session_date).slice(0, 10)) && !isCancelled(s));

    const cycle = week.map((s) => num(s.coach_cycle_week)).find((v) => v != null);
    const label = state.weekOffset === 0 ? "Cette semaine" : state.weekOffset === 1 ? "Semaine prochaine"
      : state.weekOffset === -1 ? "Semaine dernière" : `Semaine ${state.weekOffset > 0 ? "+" : ""}${state.weekOffset}`;

    const nav = h("div", { class: "week-nav" },
      h("button", { class: "btn", type: "button", "aria-label": "Semaine précédente", disabled: state.weekOffset <= minOff,
        onclick: () => { state.weekOffset--; render(); } }, icon("left")),
      h("div", { class: "week-label" }, cycle != null ? `${label} • S${cycle}` : label,
        h("small", null, `${fmtDM.format(monday)} – ${fmtDM.format(sunday)}`)),
      h("button", { class: "btn", type: "button", "aria-label": "Semaine suivante", disabled: state.weekOffset >= maxOff,
        onclick: () => { state.weekOffset++; render(); } }, icon("right")));

    const bySport = {};
    let total = 0;
    week.forEach((s) => { const m = num(s.duration_min) || 0; total += m; const k = sportKey(s.sport); bySport[k] = (bySport[k] || 0) + m; });
    const summary = h("div", { class: "week-summary" },
      h("span", { class: "badge accent" }, `Total ${fmtMin(total) || "0 min"}`),
      ["swim", "bike", "run", "str", "other"].filter((k) => bySport[k]).map((k) =>
        h("span", { class: `badge sport-${k}`, style: "background:var(--sport-bg);color:var(--sport)" }, `${SPORT_LABEL[k]} ${fmtMin(bySport[k])}`)));

    // Bannière : photo de la discipline dominante de la semaine.
    const main = Object.entries(bySport).filter(([k]) => PHOTOS[k]).sort((a, b) => b[1] - a[1])[0];
    const banner = photo(main ? main[0] : "rest", monday.getDate(), "week-hero",
      h("span", { class: "overlay-kicker" }, cycle != null ? `${label} • S${cycle}` : label),
      h("strong", { class: "overlay-title" }, total ? fmtMin(total) : "Semaine de repos"),
      h("span", { class: "overlay-sub" }, total ? `d'entraînement prévu • ${week.length} séance${week.length > 1 ? "s" : ""}` : "Aucune séance prévue"));
    const root = h("section", null, h("h1", { class: "page-title" }, "Planning"), freshness(), banner, nav, summary);
    const tIso = todayIso();
    days.forEach((iso) => {
      const list = week.filter((s) => String(s.session_date).slice(0, 10) === iso);
      const dur = list.reduce((a, s) => a + (num(s.duration_min) || 0), 0);
      const day = h("div", { class: "day" + (iso === tIso ? " today" : "") },
        h("div", { class: "day-head" },
          h("span", { class: "day-name" }, cap(fmtDayShort.format(parseISO(iso))) + (iso === tIso ? " • aujourd'hui" : "")),
          dur ? h("span", { class: "muted small" }, fmtMin(dur)) : null));
      if (list.length) list.forEach((s) => day.append(sessionCard(s)));
      else day.append(h("div", { class: "day-empty" }, "Repos"));
      root.append(day);
    });
    if (state.weekOffset === maxOff) {
      root.append(h("p", { class: "muted small", style: "margin-top:18px;text-align:center" }, "Fin du planning publié par le PC."));
    }
    return root;
  }

  // ------------------------------------------------------------- démarrage
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    state.view = t.dataset.view; store.set(K.view, state.view);
    if (state.view === "planning") state.weekOffset = 0;
    render(); window.scrollTo(0, 0);
  }));
  $("#btn-refresh").addEventListener("click", () => loadData());
  $("#btn-account").addEventListener("click", openAccountSheet);
  $("#sheet").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (state.session || state.demo) && Date.now() - state.loadedAt > 60000) loadData({ silent: true });
  });
  window.addEventListener("online", () => { if (state.session) loadData(); });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* PWA hors ligne indisponible */ });
  }

  if (state.session && !CONFIGURED) signOut(false);
  if (state.session && !state.demo) {
    const cached = store.get(K.snap);
    if (cached && cached.uid === state.session.user_id) { state.snap = cached.snap; state.snapAt = cached.at; state.commands = cached.commands || []; }
  }
  render();
  if (state.demo || state.session) loadData({ silent: true });
})();
