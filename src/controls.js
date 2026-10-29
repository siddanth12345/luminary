// Rebindable controls. Every binding is a KeyboardEvent.code ("KeyA", "Space", "ShiftLeft")
// or a mouse button ("Mouse0" = left, "Mouse1" = middle, "Mouse2" = right).
// Bindings are saved in the browser (localStorage) when it is available.

export const ACTIONS = [
    { id: 'left',     label: 'Move left',                 def: 'KeyA',      group: 'Movement' },
    { id: 'right',    label: 'Move right',                def: 'KeyD',      group: 'Movement' },
    { id: 'jump',     label: 'Jump / leave ledge',        def: 'Space',     group: 'Movement' },
    { id: 'attack',   label: 'Melee (aim matrix, hold = charge)',     def: 'Mouse0',    group: 'Attacks' },
    { id: 'neutral',  label: 'Hold: force neutral aim',   def: 'Mouse2',    group: 'Attacks' },
    { id: 'special',  label: 'F special (hold = Core)',   def: 'KeyF',      group: 'Attacks' },
    { id: 'grab',     label: 'Grab (aim, then release)',               def: 'KeyQ',      group: 'Attacks' },
    { id: 'shield',   label: 'Shield',                    def: 'KeyE',      group: 'Defense' },
    { id: 'roll',     label: 'Roll (while shielding)',    def: 'KeyR',      group: 'Defense' },
    { id: 'tutorial', label: 'Open the tutorial',         def: 'KeyH',      group: 'Menus' },
    { id: 'fullscreen', label: 'Toggle fullscreen',       def: 'Semicolon', group: 'Menus' },
    { id: 'drop',       label: 'Drop through platforms',   def: 'KeyS',      group: 'Movement' },
];

const STORE_KEY = 'luminary.controls.v1';
export const bindings = {};
for (const a of ACTIONS) bindings[a.id] = a.def;

try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) for (const a of ACTIONS) if (typeof saved[a.id] === 'string' || saved[a.id] === null) bindings[a.id] = saved[a.id];
} catch (e) { /* no storage: defaults */ }

let persister = null;
/** the account layer registers here so rebinding is saved to the profile too */
export function setBindingsPersister(fn) { persister = fn; }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(bindings)); } catch (e) { /* ignore */ } if (persister) persister({ ...bindings }); }
export const exportBindings = () => ({ ...bindings });
/** apply bindings loaded from an account (does not call the persister) */
export function importBindings(obj) {
    if (!obj) return;
    for (const a of ACTIONS) if (typeof obj[a.id] === 'string' || obj[a.id] === null) bindings[a.id] = obj[a.id];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(bindings)); } catch (e) { /* ignore */ }
}

/** every code that is currently held down (keyboard + mouse) */
export const held = new Set();
/** on-screen (touch) controls set these; they count as held inputs just like keys */
export const virtual = { left: false, right: false, shield: false, drop: false };
export const isDown = (action) => !!virtual[action] || (!!bindings[action] && held.has(bindings[action]));
export const actionsFor = (code) => ACTIONS.filter(a => bindings[a.id] === code).map(a => a.id);

/** bind `code` to `action`; if another action used it, the two swap so nothing is left unbound by accident */
export function setBinding(action, code) {
    const old = bindings[action];
    for (const a of ACTIONS) if (a.id !== action && bindings[a.id] === code) bindings[a.id] = old ?? null;
    bindings[action] = code;
    save();
}
export function resetBindings() {
    for (const a of ACTIONS) bindings[a.id] = a.def;
    save();
}

const PRETTY = {
    Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl',
    AltLeft: 'Alt', AltRight: 'Right Alt', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Mouse0: 'Left Click', Mouse1: 'Middle Click', Mouse2: 'Right Click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
    Minus: '-', Equal: '=', Backquote: '`',
};
export function codeName(code) {
    if (!code) return 'Unbound';
    if (PRETTY[code]) return PRETTY[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
}
/** label of the key currently bound to an action */
export const keyLabel = (action) => codeName(bindings[action]);
