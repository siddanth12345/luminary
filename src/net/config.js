// Online play transport settings.
//
// Leave both values empty to use the built-in LOCAL transport (BroadcastChannel): two browser
// tabs / windows of the same browser can play each other. That is the test mode.
//
// For real internet play, paste a Supabase project's URL and *publishable (anon)* key here.
// Those two values are meant to be public. The game only uses Supabase Realtime broadcast
// channels (nothing is stored), the same way Table Wars does.
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
