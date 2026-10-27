// One shared Supabase client (loaded from a CDN) for accounts and realtime.
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_JS } from './config.js';

export const supabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_KEY);
let client = null, loading = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (window.supabase) return resolve();
        const s = document.createElement('script');
        s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('could not load the Supabase library'));
        document.head.appendChild(s);
    });
}
export async function getClient() {
    if (!supabaseConfigured()) return null;
    if (client) return client;
    if (!loading) loading = loadScript(SUPABASE_JS).then(() => {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 60 } } });
        return client;
    });
    return loading;
}
