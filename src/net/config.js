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

// Online play with no setup: a public MQTT broker (WebSocket) carries the messages between computers.
// Used whenever Supabase is not configured above. Brokers are tried in order.
export const MQTT_JS = ['https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js', 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/mqtt/5.10.1/mqtt.min.js'];
// Every broker is tried AT THE SAME TIME and the first one that connects wins (a blocked or slow one no longer delays anything).
export const MQTT_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081', 'wss://mqtt.eclipseprojects.io:443/mqtt', 'wss://public.mqtthq.com:8084/mqtt', 'wss://broker.mqttdashboard.com:8884/mqtt'];
// Game traffic goes PEER TO PEER over WebRTC data channels (the broker is only used to introduce the players and as a fallback).
// STUN finds each player's public address; the free public TURN relays the data when a strict network blocks direct connections.
export const RTC_ICE = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
