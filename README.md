# Brick Kiosk — multi-touch 3D build prototype

Plain HTML/JS/WebGL (Three.js, vendored locally so it runs with no network).
No build step, no database.

## Run

    npm run dev            # binds 0.0.0.0:5173, prints every LAN address it's on
    #   local   http://127.0.0.1:5173
    #   lan     http://<your-ip>:5173     <- open this on the kiosk / tablet

`HOST=127.0.0.1 npm run dev` to keep it off the network; `PORT=8080` to move it.
It serves this directory read-only to anyone on the LAN — fine for a prototype
on a trusted network, don't leave it running on café wifi.

Kiosk shell (Electron — fullscreen, frameless, locked):

    npm i && npm run kiosk     # Ctrl/Cmd+Shift+Q to quit

## Gestures (all simultaneous — every pointer is tracked independently)

| Where | Gesture | Result |
|---|---|---|
| Plate | 1 finger drag | orbit — yaw free, tilt clamped 17°–80° |
| Plate | 2 finger pinch | zoom, clamped 12–56 units |
| Plate | 2 finger slide | spin |
| Menu | press + drag onto plate | the brick hangs off your finger in 3D; a ghost below it shows the landing spot — it tints red only if the stack would go over `MAX_STACK` |
| Menu | release | brick falls from your hand into the socket — pop, and the board bounces |
| Plate | drop onto a placed brick | it stacks; courses can be staggered or overhang |
| Plate | spin it while holding a brick | the held brick keeps its orientation, so it lands on whichever grid axis is now nearest — this is how you turn a brick 90° |
| ROTATE | tap | optional 90° offset if you'd rather not spin the view |

Keyboard: `R` rotate, `Z` undo.

## How it works

- `src/main.js` — everything: scene, camera rig, pointer routing, snapping.
- 1 world unit = 1 stud pitch (8 mm). Plate = 0.4u, brick = 1.2u.
- `heights` is an `Int16Array(16*16)` of stacked plate counts per stud column.
  Placement raycasts the baseplate + placed bricks, converts the hit to a grid
  cell, and takes the max column height under the footprint.
- **Stacking:** a brick rests on the *highest* column under its footprint, so
  courses can be staggered or overhang — that's how you build upwards. Nothing
  can ever intersect: every column is at or below `h`, and the brick starts at
  `h`. Placement only fails past `MAX_STACK` (30 plates = 10 brick courses).
  The whole footprint is then marked to `h + p`, including the air under an
  overhang — that space is sealed off, which is what stops a later brick being
  dropped into it.
- Camera is damped (0.2 lerp) with hard clamps on tilt and zoom, so it can't be
  flung off screen.
- **Orientation comes from the camera, not a button.** A drag records the plate
  angle at pickup; `gridRot()` rounds the angle travelled since to the nearest
  90° and takes its parity. Every live drag re-solves each frame, so spinning
  the plate under a stationary finger updates the landing spot and the snap.
- The held brick rides the finger's ray at a fixed height, lifted along the
  camera's up axis so it doesn't cover its own landing ghost.
- **The click.** When a brick finishes falling (~150ms) `land()` fires: a pop,
  a dip of the whole board, and a squash on the brick itself.
  - Sound is synthesised in WebAudio — no asset files, nothing to fetch. A
    bandpassed noise tick (the plastic clack) over a triangle blip whose pitch
    rises with the stack height, so a tall build sounds higher than the first
    course. Browsers only allow audio to start inside a gesture, so the context
    is armed on the kiosk's first touch.
  - `build` is a group holding the baseplate *and* every placed brick, so the
    bounce moves the model as one. It's a damped spring on Y only — grid maths
    lives in world X/Z and is untouched. ~4px dip for a 2x4, gone in ~370ms.
  - The brick squashes to 0.89 and rebounds to 1.10 on its own spring.
  - `navigator.vibrate(12)` on hardware that has it.
- `window.__kiosk` exposes state for on-site debugging.

## Hosted build (one shareable file)

    npm run bundle          # -> dist/brick-kiosk.html   (~1.2 MB, self-contained)

`tools/bundle.js` flattens the app into a single file: three.js is wrapped in an
IIFE and its final `export { ... }` rewritten to `return { ... }`, which both
gives us a `THREE` namespace and keeps its ~1500 top-level bindings out of the
app's scope (three and `src/main.js` both declare `clamp`). Output is pure
ASCII — the file carries no `<head>` of its own, so it can't declare a charset,
and a host that omits one would otherwise render `90°` as `90Â°`.

Currently published (private, shareable from the page's Share menu):
<https://claude.ai/code/artifact/b864e348-66ba-4c5a-b14b-fe9703ea5f6e>

Re-run `npm run bundle` after any source change, then republish that file to the
same URL. `dist/` is gitignored — the bundle is a build output, not a source.

## Kiosk deployment notes

- **Target: Chromium/Electron.** Only mainstream runtime with real multi-touch
  PointerEvents on Linux. Launch flags are set in `electron/main.js`
  (`--touch-events=enabled`, `--disable-pinch`).
- Chromium without Electron works too:
  `chromium --kiosk --touch-events=enabled --disable-pinch --incognito http://127.0.0.1:5173`
- `touch-action: none` on `<html>` kills all browser-level pan/zoom; the app
  owns every gesture.
- The FPS / brick / touch-count readout is bottom-right — use it to sanity-check
  the target hardware. Verify it on the real box; a browser tab that isn't in
  the foreground throttles rAF and will read 0.

## Not done yet (next passes)

- Removing / dragging an already-placed brick
- Brick colour choice independent of shape
- Rotation in 90° steps beyond a single toggle
- Idle reset / attract loop for an unattended kiosk
