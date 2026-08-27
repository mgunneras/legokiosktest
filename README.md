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
- **A brick leaves the library the way it looks in the library.** The picture is
  drawn long-side-across, so the held brick should read that way too — but a
  footprint is defined in *world* axes, and which world axis lands across the
  screen depends on the camera. `screenParity()` picks the pickup parity from the
  azimuth: world X projects along `(cos az, -sin az·cos pol)` and world Z along
  `(-sin az, -cos az·cos pol)`, and asking which is flatter reduces to
  `|sin az|` vs `|cos az|` — the tilt divides out, so only the azimuth matters.
  Worst case is 30° off horizontal, when the view sits exactly between two grid
  axes and neither choice is better.
- **Orientation comes from the camera, not a button.** A drag records the plate
  angle at pickup; `gridRot()` rounds the angle travelled since to the nearest
  90° and takes its parity. Every live drag re-solves each frame, so spinning
  the plate under a stationary finger updates the landing spot and the snap.
- The held brick rides the finger's ray at a fixed height, lifted along the
  camera's up axis so it doesn't cover its own landing ghost.
- **The lamp belongs to the room, not to the board.** The board is static in
  world space and the camera is what orbits, so a world-fixed light stays fixed
  *relative to the board* and its shadows never move — it reads as walking
  around a lit table. `placeLights()` carries the sun and rim around with
  `view.az`, pinning them to the viewer, so the model turns underneath them and
  the shadows sweep: a baseboard spun on a workbench.
  Orbiting the camera by θ around a fixed board is the same rigid transform as
  turning the board by −θ under a fixed camera — they differ by a global
  rotation about the Y axis through the board's centre, which is the axis both
  already use — so this renders identically to actually spinning the board,
  without moving the grid maths out of world space. Offsets are measured from
  `HOME.az`, so the default framing is lit exactly as it was hand-placed.
- **The click.** When a brick finishes falling (~150ms) `land()` fires: a pop
  and a knock of the whole board.
  - **Bricks never deform.** ABS is hard — nothing scales a brick group, ever,
    and the drop *accelerates* (`FALL_G`) instead of easing out, so it covers a
    fifth of the remaining gap in its last frame and then stops dead. An
    ease-out curve decelerates into the seat, which is how something soft
    settles; that plus squash-and-stretch read as rubber.
  - Sound is synthesised in WebAudio — no asset files, nothing to fetch. A
    bandpassed noise tick (the plastic clack) over a triangle blip whose pitch
    rises with the stack height, so a tall build sounds higher than the first
    course. Browsers only allow audio to start inside a gesture, so the context
    is armed on the kiosk's first touch.
  - The impact goes into the board instead, which is what you'd feel through a
    real baseplate. `build` is a group holding the baseplate *and* every placed
    brick, so it moves the model as one — a rigid translation, no deformation.
    Damped spring on Y only; grid maths lives in world X/Z and is untouched.
  - That spring is tuned as a *knock*, not a wobble: ~3.4px dip for a 2x4, a
    rebound 17% of the dip, over in 100ms. Slacken the damping and the board
    oscillates half a dozen times and the whole thing goes rubbery again.
  - `navigator.vibrate(12)` on hardware that has it.
- **Daylight theme.** One committed look, not a light/dark pair — a kiosk owns
  its screen. All UI colour comes from the tokens at the top of `src/style.css`;
  the scene's half is `SKY` (background *and* fog must match, or the fog ends in
  a visible band) plus the three lights.
  - The hemisphere light's *ground* colour does the heavy lifting. It was a dark
    slate standing in for an unlit room, which is what made every downward face
    read as dusk; bouncing off a bright floor lifts the undersides instead.
  - The accent is the red off the 1x1, so the UI is coloured by its own bricks.
    The old yellow worked on near-black and is illegible on white — an accent
    that only survives on one ground isn't an accent, it's a coincidence.
  - Text tokens are picked to clear WCAG AA at the sizes they're actually used:
    `--dim` is set for 10px labels on `--panel-2`, which is stricter than the
    same colour on white.
- **Pointer routing is window-level, deliberately.** `pointermove`/`up`/`cancel`
  are handled on `window` and dispatched by `pointerId`, not bound to the
  element a drag started on. An element only sees a pointer while its capture
  holds, and `setPointerCapture` is allowed to fail — so a lost or never-granted
  capture used to leave a session with no path to its teardown: the tile stayed
  stuck to the palette and the held brick hung over the plate for good. Worse,
  ids are reused (a mouse is always id 1), so the next press overwrote the
  session and orphaned that pair with nothing referencing them.
  Captures are still taken — they keep events coming when the pointer leaves the
  window — they just aren't what the teardown depends on. Every exit funnels
  through `closeDrag()`; `blur` and `visibilitychange` abort live drags, since
  alt-tab can swallow the `pointerup` outright, and a cancel drops nothing.
- `window.__kiosk` exposes state for on-site debugging.

## Hosted build (one shareable file)

    npm run bundle          # -> dist/brick-kiosk.html   (~1.2 MB, self-contained)

`tools/bundle.js` flattens the app into a single file: three.js is wrapped in an
IIFE and its final `export { ... }` rewritten to `return { ... }`, which both
gives us a `THREE` namespace and keeps its ~1500 top-level bindings out of the
app's scope (three and `src/main.js` both declare `clamp`). Output is pure
ASCII — the file carries no `<head>` of its own, so it can't declare a charset,
and a host that omits one would otherwise render `90°` as `90Â°`.

Useful for handing someone the whole app as one file, or hosting it anywhere
that serves a single static page. `dist/` is gitignored — the bundle is a build
output, not a source, so re-run `npm run bundle` after any source change.

## Public build (GitHub Pages)

<https://mgunneras.github.io/legokiosktest/>

Served straight from `main` at the repo root — Pages publishes the same files
`npm run dev` does, so nothing needs bundling for it. Every path in the app is
relative, which is what makes it work under a `/legokiosktest/` subpath.
`.nojekyll` keeps Pages from running the files through Jekyll.

Pushing to `main` redeploys it, usually within a minute.

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
