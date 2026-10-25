# The Luminary 3D

A Smash-style 3D arena fighter built with Three.js. Open `index.html` through any static server (e.g. `python3 -m http.server`).

## Controls
- **A / D** move, **Space** jump, **Q** dash-grab, **E** shield, **E + scroll** roll (2 s cooldown)
- **Left click** mouse dash, **Right click** J attack (aim-matrix slash)
- **F** specials: hold = Luminary Core (charge ≤ 1.5 s, straight orb at the cursor); tap + aim: Side = Blink Slash, Up = Rising Spiral, Down = Stomp (ground) / Headbutt (air). Only 2 F moves in the air until you touch the ground.
- After any move there's a 0.7 s lock (walking is free, jump unlocks after 0.3 s).

## Counters
Shield counters all but Grab · Grab loses to every active move (except Headbutt) and beats Shield · Headbutt counters all but Grab/Shield · J counters all but Shield · Core counters F moves and Grab.

## Layout
`src/core.js` simulation · `src/main.js` input/loop · `src/render/*` Three.js view, fighter rig, effects.
