// Graphics quality setting (Auto | Low | Medium | High), remembered on this device.
const KEY = 'cbg.gfx';
export const getGfx = () => { try { const v = localStorage.getItem(KEY); return ['auto', 'low', 'medium', 'high'].includes(v) ? v : 'auto'; } catch (e) { return 'auto'; } };
export function setGfx(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* blocked */ } window.dispatchEvent(new CustomEvent('cbg-gfx')); }
