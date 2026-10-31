// A transport moves small JSON messages between the two players of a room.
//   const t = await openTransport(code); t.onmessage = (msg) => ...; t.send(msg); t.close();
import { getClient, supabaseConfigured } from './supa.js';
import { MQTT_JS, MQTT_BROKERS, RTC_ICE } from './config.js';

const forced = () => { try { return localStorage.getItem('luminary-transport'); } catch (e) { return null; } };
/** true when messages can reach other computers (anything except the same-browser test transport) */
export const hasRealtime = () => forced() !== 'local' && !onlineBlocked;

// ---- public MQTT brokers over WebSocket: work between computers with no account or server of our own.
// EVERY broker that answers is used at the same time (subscribe + publish on all of them, duplicates dropped), so two players
// always share at least one broker even when each one's connection to some brokers is slow or blocked.
const pool = [];                              // connected broker clients
let mqttLoading = null;
const subs = new Map();                       // topic -> Set(transport)
const seenMsg = new Set(), seenOrder = [];
function dupe(m) {
    const k = m.s + ':' + m.n; if (seenMsg.has(k)) return true;
    seenMsg.add(k); seenOrder.push(k); if (seenOrder.length > 800) seenMsg.delete(seenOrder.shift()); return false;
}
function loadMqtt() {
    if (window.mqtt) return Promise.resolve();
    const urls = Array.isArray(MQTT_JS) ? MQTT_JS : [MQTT_JS];
    return urls.reduce((p, src) => p.catch(() => new Promise((resolve, reject) => {
        if (window.mqtt) return resolve();
        const s = document.createElement('script');
        s.src = src; s.onload = () => window.mqtt ? resolve() : reject(new Error('bad library')); s.onerror = () => reject(new Error('could not load the network library'));
        document.head.appendChild(s);
    })), Promise.reject(new Error('start')));
}
let blocked = false;
window.addEventListener('securitypolicyviolation', (e) => { if (/^wss?:/.test(e.blockedURI || '') || e.violatedDirective === 'connect-src') blocked = true; });
export let onlineBlocked = false;     // true when this page cannot reach the internet (sandboxed preview): same-browser play only
export const brokerStatus = { up: 0, total: 0 };
function attach(c) {
    c.on('message', (topic, buf) => {
        let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
        if (dupe(m)) return;
        for (const t of subs.get(topic) || []) if (m.s !== t.id) t.recv(m);
    });
    const sync = () => { for (const topic of subs.keys()) c.subscribe(topic, { qos: 0 }); brokerStatus.up = pool.filter((x) => x.connected).length; };
    c.on('connect', sync); c.on('close', () => { brokerStatus.up = pool.filter((x) => x.connected).length; }); c.on('offline', () => { brokerStatus.up = pool.filter((x) => x.connected).length; });
    pool.push(c); sync();
}
function connectBroker(url, kill) {
    return new Promise((resolve, reject) => {
        let c;
        try { c = window.mqtt.connect(url, { reconnectPeriod: 3000, connectTimeout: 12000, keepalive: 30, clean: true, clientId: 'cbg_' + Math.random().toString(16).slice(2, 12) }); } catch (e) { return reject(e); }
        const timer = setTimeout(() => { try { c.end(true); } catch (e) { /* ignore */ } reject(new Error('timeout')); }, 13000);
        c.once('connect', () => { clearTimeout(timer); resolve(c); });
        c.once('error', (e) => { clearTimeout(timer); try { c.end(true); } catch (x) { /* ignore */ } reject(e); });
    });
}
/** connect to every broker at once; resolves after the first one answers (plus a short grace period for the others) */
async function getMqtt() {
    if (pool.some((c) => c.connected)) return pool;
    if (!mqttLoading) mqttLoading = (async () => {
        await loadMqtt();
        if (blocked) throw new Error('blocked');
        const list = (() => { try { const o = JSON.parse(localStorage.getItem('luminary-brokers')); if (Array.isArray(o) && o.length) return o; } catch (e) { /* default list */ } return MQTT_BROKERS; })();
        brokerStatus.total = list.length;
        await new Promise((resolve, reject) => {
            let failed = 0, ok = 0, grace = null;
            for (const url of list) connectBroker(url).then((cl) => {
                attach(cl); ok++;
                if (ok === 1) grace = setTimeout(resolve, 1800);
                if (ok >= 3) { clearTimeout(grace); resolve(); }
            }).catch(() => { if (++failed === list.length && !ok) reject(new Error('none of the ' + failed + ' online servers could be reached')); else if (failed + ok === list.length) resolve(); });
        }).catch((e) => { mqttLoading = null; throw new Error('could not reach an online server (' + e.message + ')'); });
        return pool;
    })();
    return mqttLoading;
}

class MqttTransport {
    constructor(code) {
        this.topic = 'luminary/v1/' + code; this.id = Math.random().toString(36).slice(2, 10); this.onmessage = null; this.local = false;
        this.rtcRole = null; this.peers = new Map(); this.info = { mode: 'relay', rtt: 0 }; this.pingT = 0; this.mqttRtt = 0; this.seq = 0;
    }
    async open() {
        await getMqtt();
        if (!subs.has(this.topic)) subs.set(this.topic, new Set());
        subs.get(this.topic).add(this);
        await Promise.all(pool.filter((c) => c.connected).map((c) => new Promise((resolve) => c.subscribe(this.topic, { qos: 0 }, () => resolve()))));
    }
    raw(d) {
        const s = JSON.stringify({ s: this.id, n: ++this.seq, d });
        for (const c of pool) if (c.connected) { try { c.publish(this.topic, s, { qos: 0 }); } catch (e) { /* offline */ } }
    }

    // ---------------------------------------------------------------- peer to peer upgrade (WebRTC data channels)
    /** role 'host' | 'guest': from now on snapshots / inputs travel directly between the players when a direct channel is open */
    enableRtc(role) {
        if (!window.RTCPeerConnection) return;
        this.rtcRole = role;
        clearInterval(this.pingT);
        this.pingT = setInterval(() => this.tick(), 2000);
    }
    tick() {
        const now = Date.now();
        for (const [id, p] of this.peers) if (now - p.seen > 20000 && !(p.ru && p.ru.readyState === 'open')) { this.dropPeer(id); }
        const open = this.openPeers();
        this.info.mode = open.length ? 'p2p' : 'relay';
        if (open.length) for (const p of open) { try { p.rr.send(JSON.stringify({ _p: now })); } catch (e) { /* closing */ } }
        else this.raw({ t: '_p', ts: now });
    }
    openPeers() { const a = []; for (const p of this.peers.values()) if (p.ru && p.ru.readyState === 'open' && p.rr && p.rr.readyState === 'open') a.push(p); return a; }
    dropPeer(id) { const p = this.peers.get(id); if (!p) return; try { p.pc.close(); } catch (e) { /* ignore */ } this.peers.delete(id); }
    makePeer(id) {
        const pc = new RTCPeerConnection({ iceServers: RTC_ICE });
        const p = { pc, id, ru: null, rr: null, seen: Date.now(), at: Date.now(), pend: [], remote: false };
        this.peers.set(id, p);
        pc.onicecandidate = (e) => { if (e.candidate) this.raw({ t: 'rtc', to: id, k: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
        pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { p.dead = true; } };
        return p;
    }
    wireChannel(p, ch) {
        if (ch.label === 'u') p.ru = ch; else p.rr = ch;
        ch.onmessage = (e) => {
            let m; try { m = JSON.parse(e.data); } catch (x) { return; }
            if (m._p) { try { p.rr.send(JSON.stringify({ _q: m._p })); } catch (x) { /* closing */ } return; }
            if (m._q) { this.info.rtt = Math.round(Date.now() - m._q); return; }
            p.seen = Date.now();
            this.onmessage && this.onmessage(m);
        };
    }
    ensurePeer(id) {
        const cur = this.peers.get(id);
        if (cur) { cur.seen = Date.now(); if (!cur.dead && !(cur.pc.connectionState === 'failed')) return; if (Date.now() - cur.at < 5000) return; this.dropPeer(id); }
        const p = this.makePeer(id);
        this.wireChannel(p, p.pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
        this.wireChannel(p, p.pc.createDataChannel('r', { ordered: true }));
        p.pc.createOffer().then((o) => p.pc.setLocalDescription(o)).then(() => this.raw({ t: 'rtc', to: id, k: 'offer', sdp: p.pc.localDescription.sdp }))
            .catch(() => { p.dead = true; });
    }
    async onSignal(from, d) {
        try {
            if (d.k === 'offer' && this.rtcRole === 'guest') {
                this.dropPeer(from);
                const p = this.makePeer(from);
                p.pc.ondatachannel = (e) => this.wireChannel(p, e.channel);
                await p.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp }); p.remote = true;
                for (const c of p.pend.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
                const ans = await p.pc.createAnswer(); await p.pc.setLocalDescription(ans);
                this.raw({ t: 'rtc', to: from, k: 'answer', sdp: p.pc.localDescription.sdp });
            } else if (d.k === 'answer' && this.rtcRole === 'host') {
                const p = this.peers.get(from); if (!p || p.remote) return;
                await p.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }); p.remote = true;
                for (const c of p.pend.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
            } else if (d.k === 'ice') {
                const p = this.peers.get(from); if (!p) return;
                if (p.remote) await p.pc.addIceCandidate(d.c).catch(() => {}); else p.pend.push(d.c);
            }
        } catch (e) { /* a failed negotiation just leaves us on the relay */ }
    }
    /** every message that arrives from the broker */
    recv(m) {
        const d = m.d;
        if (d && d.t === 'rtc') { if (d.to === this.id) this.onSignal(m.s, d); return; }
        if (d && d.t === '_p') { this.raw({ t: '_q', to: m.s, ts: d.ts }); return; }
        if (d && d.t === '_q') { if (d.to === this.id) this.info.rtt = Math.round(Date.now() - d.ts); return; }
        if (this.rtcRole === 'host') this.ensurePeer(m.s);
        else if (this.rtcRole === 'guest') { const p = this.peers.get(m.s); if (p) p.seen = Date.now(); }
        if (d && d.t === 'snap' && this.rtcRole === 'guest' && this.openPeers().length) return;       // the direct channel already delivers snapshots
        this.onmessage && this.onmessage(d);
    }
    send(msg) {
        const k = msg && msg.t;
        if (this.rtcRole === 'host' && k === 'snap') {
            const s = JSON.stringify(msg); let all = this.peers.size > 0;
            for (const p of this.peers.values()) { if (p.ru && p.ru.readyState === 'open') { try { p.ru.send(s); } catch (e) { all = false; } } else all = false; }
            if (all) return;                                                                                // everyone has a direct channel: no relay traffic at all
        } else if (this.rtcRole === 'guest' && (k === 'held' || k === 'act')) {
            const o = this.openPeers();
            if (o.length) { try { o[0].rr.send(JSON.stringify(msg)); return; } catch (e) { /* fall through to the relay */ } }
        }
        this.raw(msg);
    }
    send_(msg) { this.send(msg); }
    close() {
        clearInterval(this.pingT);
        for (const id of [...this.peers.keys()]) this.dropPeer(id);
        const set = subs.get(this.topic);
        if (set) { set.delete(this); if (!set.size) { subs.delete(this.topic); for (const c of pool) { try { c.unsubscribe(this.topic); } catch (e) { /* ignore */ } } } }
    }
}

class LocalTransport {
    constructor(code) { this.ch = new BroadcastChannel('luminary-room-' + code); this.onmessage = null; this.local = true; this.info = { mode: 'local', rtt: 0 }; }
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
        if (blocked || /blocked/.test(e.message)) {            // the sandboxed preview cannot reach the internet at all: same-browser play only
            onlineBlocked = true;
            t = new LocalTransport(code); await t.open();
        } else throw e;                                         // a real network problem: say so instead of silently playing alone
    }
    return t;
}
