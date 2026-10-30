// Shared item data (names, descriptions, defaults) used by the game core, the renderer and the custom-match UI.
export const ITEM_TYPES = ['BALL', 'STRAWBERRY', 'BALLOON', 'FIRESTICK', 'CLOCK'];

export const ITEM_INFO = {
    BALL: {
        name: 'Ball', icon: '🏀',
        desc: 'Grab it, then aim a grab to throw it: 10 damage. It bounces back off whoever it hits, bounces and rolls a little on the ground, and can be thrown twice before it breaks. It counters every attack except a grab, and grabbing it catches it. Despawns after 1 minute of rest.',
    },
    STRAWBERRY: {
        name: 'Strawberry', icon: '🍓',
        desc: 'Grab it to heal 30%. Used instantly.',
    },
    BALLOON: {
        name: 'Balloon', icon: '🎈',
        desc: 'Grab it to get 7 jumps (until you are knocked out). After your normal 4 jumps you tug on the balloon string for the extra ones. Jump to use it. Hitting someone with a melee while holding it pops it: they get knockback and 0.65x gravity for 2 seconds.',
    },
    FIRESTICK: {
        name: 'Firestick', icon: '🔥',
        desc: 'Grab it and all your melee attacks get a 5x longer hitbox. The stick loses 0.5 length every time you hit or get hit, and burns out after 6 reductions. Aim a grab to throw it like a spear: whoever it hits takes 15 damage and gets stuck to it until it hits the ground. If it flies below the stage tip they are freed and get their jumps back. Each hit costs it 0.5 length.',
    },
    CLOCK: {
        name: 'Clock', icon: '⏰',
        desc: 'Grab it and aim a grab to throw it. One second after the throw it starts a time bubble: orbs and items inside move at 0.3x speed. Fighters are not affected. The bubble is as wide as the original map and lasts 15 seconds.',
    },
};

export const ITEM_DEFAULT = { on: false, types: ITEM_TYPES.slice(), interval: 15 };
export const ITEM_INTERVAL_MIN = 5;
export const ITEM_INTERVAL_MAX = 60;
