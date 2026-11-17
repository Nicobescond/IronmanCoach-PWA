// Configuration Supabase de la PWA.
// Ces deux valeurs sont PUBLIQUES par conception : la securite repose sur
// la connexion de chaque athlete et sur les regles RLS (supabase/schema.sql).
// Ne JAMAIS mettre ici la cle "secret" / "service_role".
window.IC_CONFIG = {
  // Supabase > Project Settings > Data API > Project URL
  supabaseUrl: "",          // ex. "https://abcdefghijkl.supabase.co"
  // Supabase > Project Settings > API Keys > Publishable key
  supabaseKey: "",          // ex. "sb_publishable_..."
};
