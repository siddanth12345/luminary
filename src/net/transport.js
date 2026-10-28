// A transport moves small JSON messages between the two players of a room.
//   const t = await openTransport(code); t.onmessage = (msg) => ...; t.send(msg); t.close();
import { getClient, supabaseConfigured } from './supa.js';
import { MQTT_JS, MQTT_BROKERS } from './config.js';

const forced = () => { try { return localStorage.getItem('luminary-transport'); } catch (e) { return null; } };
/** true when messages can reach other computers (anything except the same-browser test transport) */
export const hasRealtime = () => forced() !== 'local' && !onlineBlocked;

// ---- public MQTT broker over WebSocket: works between computers with no account or server of our own
let mqttClient = null, mqttLoading = null;
const subs = new Map();                       // topic -> Set(transport)
function loadMqtt() {
    return new Promise((resolve, reject) => {
        if (window.mqtt) return resolve();
        const s = document.createElement('script');
        s.src = MQTT_JS; s.onload = () => resolve(); s.onerror = () => reject(new Error('could not load the network library'));
        document.head.appendChild(s);
    });
}
let blocked = false;
window.addEventListener('securitypolicyviolation', (e) => { if (/^wss?:/.test(e.blockedURI || '') || e.violatedDirective === 'connect-src') blocked = true; });
export let onlineBlocked = false;     // true when this page cannot reach the internet (sandboxed preview): same-browser play only
function connectBroker(url) {
    return new Promise((resolve, reject) => {
        const poll = setInterval(() => { if (blocked) { clearInterval(poll); reject(new Error('blocked')); } }, 100);
        const c = window.mqtt.connect(url, { reconnectPeriod: 2000, connectTimeout: 6000, clean: true, clientId: 'lum_' + Math.random().toString(16).slice(2, 12) });
        const timer = setTimeout(() => { clearInterval(poll); try { c.end(true); } catch (e) { /* ignore */ } reject(new Error('broker timeout')); }, 5000);
        c.once('connect', () => { clearTimeout(timer); clearInterval(poll); resolve(c); });
        c.once('error', (e) => { clearTimeout(timer); clearInterval(poll); try { c.end(true); } catch (x) { /* ignore */ } reject(e); });
    });
}
async function getMqtt() {
    if (mqttClient) return mqttClient;
    if (!mqttLoading) mqttLoading = (async () => {
        await loadMqtt();
        let last = null;
        for (const url of MQTT_BROKERS) {
            if (blocked) break;
            try {
                const c = await connectBroker(url);
                c.on('message', (topic, buf) => {
                    let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
                    for (const t of subs.get(topic) || []) if (m.s !== t.id) t.onmessage && t.onmessage(m.d);
                });
                c.on('connect', () => { for (const topic of subs.keys()) c.subscribe(topic, { qos: 0 }); });   // re-subscribe after reconnects
                mqttClient = c; return c;
            } catch (e) { last = e; }
        }
        mqttLoading = null;
        throw new Error('could not reach an online server (' + (last && last.message || 'offline') + ')');
    })();
    return mqttLoading;
}

class MqttTransport {
    constructor(code) { this.topic = 'luminary/v1/' + code; this.id = Math.random().toString(36).slice(2, 10); this.onmessage = null; this.local = false; }
    async open() {
        const c = await getMqtt();
        if (!subs.has(this.topic)) subs.set(this.topic, new Set());
        subs.get(this.topic).add(this);
        await new Promise((resolve, reject) => c.subscribe(this.topic, { qos: 0 }, (err) => err ? reject(err) : resolve()));
    }
    send(msg) { try { mqttClient.publish(this.topic, JSON.stringify({ s: this.id, d: msg }), { qos: 0 }); } catch (e) { /* offline */ } }
    close() {
        const set = subs.get(this.topic);
        if (set) { set.delete(this); if (!set.size) { subs.delete(this.topic); try { mqttClient.unsubscribe(this.topic); } catch (e) { /* ignore */ } } }
    }
}

class LocalTransport {
    constructor(code) { this.ch = new BroadcastChannel('luminary-room-' + code); this.onmessage = null; this.local = true; }
    async open() { this.ch.onmessage = (e) => this.onmessage && this.onmessage(e.data); }
    send(msg) { try { this.ch.postMessage(msg); } catch (e) { /* closed */ } }
    close() { try { this.ch.close(); } catch (e) { /* already closed */ } }
}

class SupabaseTransport {
    constructor(code) { this.code = code; this.onmessage = null; this.local = false; this.client = null; this.ch = null; }
    async open() {
        this.client = await getClient();
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
    const mode = forced();
    let t = mode === 'local' ? new LocalTransport(code) : (mode !== 'mqtt' && supabaseConfigured()) ? new SupabaseTransport(code) : new MqttTransport(code);
    try { await t.open(); }
    catch (e) {                                  // no internet route (e.g. the sandboxed preview): fall back to same-browser play
        if (t.local) throw e;
        onlineBlocked = true;
        t = new LocalTransport(code); await t.open();
    }
    return t;
}
