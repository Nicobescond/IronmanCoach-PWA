// Donnees FICTIVES pour le mode demonstration (aucune donnee reelle).
// Meme format que le snapshot envoye par le PC (mobile_sync.build_snapshot).
window.IC_DEMO = (function () {
  function iso(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  const TEMPLATES = {
    1: [["swim", "Natation technique", 50, [
          ["Échauffement souple", "distance", 400, "open", null, null, "warmup", 1, 0, ""],
          ["Éducatifs", "distance", 50, "open", null, null, "active", 8, 15, "Rattrapé / un bras / poings fermés"],
          ["Bloc CSS", "distance", 200, "pace", 108, 113, "active", 4, 30, "Allure CSS, respiration 3 temps"],
          ["Retour souple", "distance", 200, "open", null, null, "cooldown", 1, 0, ""]]]],
    2: [["run", "Course seuil", 60, [
          ["Échauffement", "time", 15, "hr", 128, 138, "warmup", 1, 0, ""],
          ["Bloc seuil", "time", 8, "pace", 262, 270, "active", 3, 120, "Relâché, cadence haute"],
          ["Retour au calme", "time", 10, "open", null, null, "cooldown", 1, 0, ""]]]],
    3: [["bike", "Vélo endurance aéro", 90, [
          ["Échauffement", "time", 15, "power", 140, 170, "warmup", 1, 0, ""],
          ["Endurance aéro", "time", 20, "power", 185, 205, "active", 3, 180, "Position aéro, 60 g glucides/h"],
          ["Retour au calme", "time", 10, "open", null, null, "cooldown", 1, 0, ""]]],
        ["str", "Renfo gainage", 25, [
          ["Circuit renforcement", "time", 25, "open", null, null, "active", 1, 0, "Gainage, fentes, mollets"]]]],
    4: [["swim", "Natation endurance", 45, [
          ["Échauffement", "distance", 300, "open", null, null, "warmup", 1, 0, ""],
          ["Endurance", "distance", 400, "pace", 115, 122, "active", 4, 20, "Nage régulière"],
          ["Retour souple", "distance", 200, "open", null, null, "cooldown", 1, 0, ""]]]],
    5: [],
    6: [["bike", "Sortie longue", 180, [
          ["Corps de séance", "time", 180, "power", 0, 220, "active", 1, 0, "Plafond ≤ 80 % FTP, hydratation 500 ml/h"]]],
        ["run", "Enchaînement course", 20, [
          ["Course facile", "time", 20, "hr", 130, 142, "active", 1, 0, "Foulée courte en sortie de vélo"]]]],
    0: [["run", "Sortie longue course", 85, [
          ["Endurance fondamentale", "time", 85, "hr", 128, 140, "active", 1, 0, "Gel toutes les 40 min"]]]],
  };

  function build() {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = addDays(today, -3);
    const end = addDays(today, 34);
    const planning = [];
    let id = 1000, stepId = 1;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const dayIso = iso(d);
      (TEMPLATES[d.getDay()] || []).forEach(([sport, title, dur, steps], i) => {
        const sid = id++;
        const past = d < today && dayIso !== iso(today);
        planning.push({
          id: sid, session_date: dayIso, title, sport, duration_min: dur,
          objective: sport === "bike" ? "Endurance spécifique" : sport === "run" ? "Seuil contrôlé" : "Technique et régularité",
          notes: i === 0 ? "Séance de démonstration." : "",
          status: "planned", priority: "B", nutrition: dur >= 90 ? "60–80 g de glucides/h, 500 ml/h" : null,
          optional: 0, user_locked: 0, user_moved: 0, coach_generated: 1,
          steps: steps.map((s, k) => ({
            id: stepId++, session_id: sid, step_order: k, step_name: s[0], duration_type: s[1],
            duration_value: s[2], target_type: s[3], target_low: s[4], target_high: s[5],
            intensity: s[6], repetitions: s[7], recovery_s: s[8], notes: s[9],
          })),
          feedback: past ? { completed: 1, rpe: 6, feeling: 7, pain: 0 } : undefined,
        });
      });
    }
    const goalDate = addDays(today, 150);
    return {
      schema_version: 2, app_version: "démo", generated_at: new Date().toISOString(),
      profile: { name: "Alex", ftp: 275, threshold_hr: 160 },
      today: {
        date: iso(today),
        sessions: planning.filter((s) => s.session_date === iso(today)),
        next_goal: { id: 1, race_date: iso(goalDate), name: "Triathlon L (démo)", race_type: "Triathlon L", priority: "A" },
        latest_weight: { measurement_date: iso(addDays(today, -1)), weight_kg: 72.4 },
        wellness: { day: iso(today), fatigue: 3, soreness: 2 },
        latest_feedback: { completed: 1, rpe: 6, feeling: 7, pain: 0 },
        recovery: { is_current: true, resting_hr: 47, hrv_ms: 62, sleep_score: 81, training_readiness: 68 },
        load_summary: { is_current: true, ctl: 64.2, atl: 71.8, tsb: -7.6, atl_ctl_ratio: 1.12, load_7d: 480, load_7d_change_pct: 8, planned_load_7d: 510 },
        indicator_limits: {
          load: {
            ctl: { level: "good", label: "EN HAUSSE", limit: "pas de limite absolue : trajectoire sur 28 j" },
            atl_ctl: { level: "good", label: "MAÎTRISÉ", limit: "vigilance ≥ 1,35 • élevée ≥ 1,55" },
            tsb: { level: "neutral", label: "FATIGUE NORMALE", limit: "vigilance < −12 • très négatif < −25" },
            load_7d: { level: "good", label: "PROGRESSION CONTRÔLÉE", limit: "vigilance ≥ +50 % si la semaine précédente ≥ 50" },
          },
          recovery: {
            subjective: { level: "good", label: "TOLÉRANCE CORRECTE", limit: "alerte : fatigue/courbatures ≥ 7 • douleur ≥ 5" },
            hrv: { level: "neutral", label: "DANS LA NORME", limit: "comparée à la référence personnelle" },
            resting_hr: { level: "good", label: "STABLE", limit: "vigilance à +4 bpm • forte alerte à +7 bpm" },
            training_readiness: { level: "watch", label: "MODÉRÉE", limit: "vigilance < 50" },
          },
        },
      },
      planning,
      planning_window: { start: iso(start), end: iso(end) },
      goals: [{ id: 1, race_date: iso(goalDate), name: "Triathlon L (démo)", race_type: "Triathlon L", priority: "A" }],
    };
  }
  return { build };
})();
