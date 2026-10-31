// Graphics quality setting (Auto | Low | Medium | High), remembered on this device.
const KEY = 'cbg.gfx';
export const getGfx = () => { try { const v = localStorage.getItem(KEY); return ['auto', 'low', 'medium', 'high'].includes(v) ? v : 'auto'; } catch (e) { return 'auto'; } };
export function setGfx(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* blocked */ } window.dispatchEvent(new CustomEvent('cbg-gfx')); }

// Show the red attack hitboxes (off by default), remembered on this device.
const HKEY = 'cbg.hitboxes';
export const getHitboxes = () => { try { return localStorage.getItem(HKEY) === '1'; } catch (e) { return false; } };
export function setHitboxes(on) { try { localStorage.setItem(HKEY, on ? '1' : '0'); } catch (e) { /* blocked */ } window.dispatchEvent(new CustomEvent('cbg-hb')); }
