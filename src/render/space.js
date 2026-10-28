// Mapping between the game's 2D simulation space and 3D render space.
//
//   game:   x -> right, y -> DOWN, world 3800 x 2100   (unchanged from the 2D original)
//   render: x -> right, y -> UP,   z -> toward the camera
//
// The centre of the map is the 3D origin, and it is also the point the camera looks at,
// so the middle of the screen is always the middle of the map. All gameplay stays in the
// 2D plane z = 0; depth is purely visual.
import { WORLD } from '../core.js';

export let CX = WORLD.width / 2;   // 1900 (live: the lobby arena is bigger)
export let CY = WORLD.height / 2;  // 1050
export function syncSpace() { CX = WORLD.width / 2; CY = WORLD.height / 2; }

export const wx = (x) => x - CX;
export const wy = (y) => CY - y;

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
/** progress of u inside the window [a, b], clamped to 0..1 */
export const seg = (u, a, b) => clamp01((u - a) / (b - a));
export const D2R = Math.PI / 180;
