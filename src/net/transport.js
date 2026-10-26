// A transport moves small JSON messages between the two players of a room.
//   const t = await openTransport(code); t.onmessage = (msg) => ...; t.send(msg); t.close();
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_JS } from './config.js';

export const hasRealtime = () => !!(SUPABASE_URL && SUPABASE_KEY);

class LocalTransport {
    constructor(code) { this.ch = new BroadcastChannel('luminary-room-' + code); this.onmessage = null; this.local = true; }
    async open() { this.ch.onmessage = (e) => this.onmessage && this.onmessage(e.data); }
    send(msg) { try { this.ch.postMessage(msg); } catch (e) { /* closed */ } }
    close() { try { this.ch.close(); } catch (e) { /* already closed */ } }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (window.supabase) return resolve();
        const s = document.createElement('script');
        s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('could not load the Supabase library'));
        document.head.appendChild(s);
    });
}

class SupabaseTransport {
    constructor(code) { this.code = code; this.onmessage = null; this.local = false; this.client = null; this.ch = null; }
    async open() {
        await loadScript(SUPABASE_JS);
        this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 60 } } });
        this.ch = this.client.channel('luminary:' + this.code, { config: { broadcast: { self: false, ack: false } } });
        this.ch.on('broadcast', { event: 'm' }, ({ payload }) => this.onmessage && this.onmessage(payload));
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timed out connecting to the server')), 10000);
            this.ch.subscribe((status) => {
                if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('server connection failed (' + status + ')')); }
            });
        });
    }
    send(msg) { try { this.ch.send({ type: 'broadcast', event: 'm', payload: msg }); } catch (e) { /* offline */ } }
    close() { try { this.client.removeChannel(this.ch); } catch (e) { /* ignore */ } }
}

export async function openTransport(code) {
    const t = hasRealtime() ? new SupabaseTransport(code) : new LocalTransport(code);
    await t.open();
    return t;
}
