# Cool Battle Game (CBG)

A Smash-style 3D arena fighter built with Three.js. Open `index.html` through any static server (e.g. `python3 -m http.server`).

## Controls
- **A / D** move, **Space** jump, **Q** dash-grab, **E** shield, **E + scroll** roll (2 s cooldown)
- **Left click** J attack (aim-matrix slash, hitbox follows the swing), **Right click** mouse dash
- **F** specials: hold = CBG Core (charge ≤ 1.5 s, straight orb at the cursor); tap + aim: Side = Blink Slash, Up = Rising Spiral, Down = Suplex (ground: dash-grab, carry up, slam) / Headbutt (air). Only 2 F moves in the air until you touch the ground.
- After any move there's a 0.7 s lock (walking is free, jump unlocks after 0.3 s).

## Counters
Shield counters all but Grab · Grab loses to every active move (except Headbutt) and beats Shield · Headbutt counters all but Grab/Shield · J counters all but Shield · Core counters F moves and Grab.

## Layout
`src/core.js` simulation · `src/main.js` input/loop · `src/render/*` Three.js view, fighter rig, effects.

## Online play
Works between computers with **no setup**: matches travel over a public MQTT relay (`src/net/config.js`), so share a 4-letter code and play. (For private/own infrastructure, fill in the Supabase values in the same file, which take over automatically.)
- **Quick match / 1v1 rooms**, **Custom match** (up to 8 players, FFA or red/blue/yellow/green teams, starting damage, stocks, 2.5x arena with Battlefield platforms), **Party** (leader + 4, launches a 1v1 or custom match for everyone), **Borgs** (friends), accounts and guests, chat.
- The host's browser runs the match; guests send inputs and see snapshots. Test mode in one browser: `localStorage.setItem('luminary-transport','local')`.
- Accounts are stored per-browser until a Supabase project is configured (see `supabase/luminary.sql`); friends/presence/invites work across computers through the relay.

