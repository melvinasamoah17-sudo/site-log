// Fill these in from your Supabase project: Settings → API.
// The "anon" key is safe to put in client-side code — it's designed for
// this. Never put your "service_role" key here or anywhere in the frontend.

const SUPABASE_URL = 'https://rbdfnfvxttatucfnkbjt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YIuVfy1vlpia-EaAlg4cfg__3vWnztc';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
