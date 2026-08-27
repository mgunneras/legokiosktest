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
| Plate | release while still moving | the brick is thrown — it arcs in and clicks home |
| Plate | press and hold a brick (300ms) | edges light, then it lifts back into your hand |
| Plate | double-tap a brick | it gets chucked off the table |
| Plate | release off the build | it lands on the desk and stays there, pickable later |
| MORE BRICKS | tap | next tray page — bricks, slopes, curves |
| CLEAR | tap | demolition — the build leaves one brick at a time |
| WHAT NEXT? | tap | Gemini suggests one thing to add |

Keyboard: `R` rotate, `Z` undo.

## How it works

- `src/main.js` — everything: scene, camera rig, pointer routing, snapping.
- 1 world unit = 1 stud pitch (8 mm). Plate = 0.4u, brick = 1.2u.
- **Shape is skin, except where it isn't.** Slopes, curves and round parts are a
  2D side profile extruded across the piece's depth — four points for a slope,
  three and an arc for a curve — cached per part. Footprint and height are
  unchanged, so placement, stacking and physics stay in the grid.
  But height alone cannot describe a slope: the angled half stands as tall as
  the rest and has no studs on it. So there is a second map, `matable`, one flag
  per column, written by `stamp()` alongside `heights`. A piece rests on the
  columns that reach `h`, and **at least one of them must carry studs** — one
  stud holds a brick, so a piece may grip a slope's flat half and overhang its
  angled half, but it may not rest on the angled face alone. Round tiles have no
  studs anywhere and take nothing.
- **Rotation is a real quarter turn**, not a swap of width and depth. For a box
  those are the same thing; for a wedge they are different solids. So a shaped
  part is modelled facing one way and turned into place, and `stamp()` maps the
  piece's own columns to world columns accordingly. The angles are geometry rather than marketing: a brick-height fall
  across one stud is ~50°, which is the element everyone calls a 45; across two
  studs it is ~31°, the one called a 33.
- The tray pages, but `CATALOG` stays whole behind it, so Gemini's piece indices
  are valid whichever page happens to be open.
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
- **Three states, one at a time.** `placed` is the build: seated, grid-aligned,
  part of `heights`. `loose` is the desk: resting where it fell, at any angle, in
  no grid — pickable (`pickList`) but deliberately never stackable (`hitList`),
  since an off-grid brick has no column to resolve against. `flying` is neither:
  owned by the simulation until it commits to one of the others, or to nothing.
- **The held brick hovers close** — about 0.7 of a brick height off the surface
  it would land on. `HOVER` and `LIFT` stack (the second pushes along the
  camera's up axis, not straight up), which at the original values put it over
  three brick heights away, floating rather than being held.
- **A 90° turn is a twist, not a swap.** `gridTurns()` accumulates signed
  quarter-turns instead of collapsing to parity, so the held brick is built once
  and rotated (~200ms) rather than rebuilt with its dimensions exchanged. The
  ghost still snaps instantly — it answers "where does this land", not "what is
  my hand doing". Because the throw now launches from a low hover, `FLICK_LIFT`
  carries more of the arc than it used to: same throw, less height to fall from.
- **Throwing.** Release with the hand still moving and the brick arcs in. Hand
  speed and launch speed are different scales — an ordinary drag clocks ~19u/s
  across the hover plane and a real flick ~110, but a brick only wants to travel
  a few studs, so the throw is a scaled, clamped version of the hand: ~2 studs
  for a nudge, ~10 for a hard one. Whether it sticks is rolled at launch, not on
  arrival, so a dud tumbles the whole way in. Overshooting the board fails
  regardless of the roll, which gives the throw some actual skill.
- **Picking a brick back up** is a hold, not a tap, so it can't fight the orbit:
  the hold is abandoned the moment the finger travels more than `HOLD_SLOP`.
  Blocked if anything rests on it — every column under the footprint must top
  out at that brick — which is also what makes `rebuildHeights()` safe to replay
  after a removal, since nothing above could have depended on it.
- **Sounds are separated by shape, not just pitch,** so they're told apart with
  no attention paid: seating is a very short high sine tick (a low body with a
  long fall reads as a gunshot); coming loose and being thrown are the same
  sweep run in both directions; a botched landing is filtered noise; refusing is
  a squarewave two-step down, deliberately the ugliest thing here.
- **The start screen is load-bearing.** A plain tap on an element that neither
  calls `preventDefault()` nor captures the pointer is the one interaction iOS
  reliably accepts as permission to make sound, and building never produces one:
  a drag does both. Everything above (context at load, silent-sample kick,
  per-gesture retry, rebuild-on-refusal) still runs and gets sound going without
  it on every other browser — but on iPad it is the tap that does it. It cannot
  be faked: calling the handler from script carries no user activation.
- **Diagnosing audio on the device.** The bottom-right readout ends with
  `audio <state>/<tries>` — `idle` before any gesture, then the context's own
  state and how many gestures have been spent trying to start it. `running/1`
  is healthy. Anything stuck on `suspended` means the browser is refusing, and
  the number says whether `unlock()` is even being reached.
- **iOS audio: build the context up front, resume it on a gesture.** Measured on
  iPad Safari via the readout above: a context *created and resumed inside the
  same gesture* stays suspended, and only starts on a later gesture that resumes
  an already-existing one. Building it lazily therefore spent the first touch on
  construction, which is why sound appeared only once you happened to tap a tool
  button afterwards. It is now constructed at load — it is born suspended either
  way, so this costs nothing — leaving every gesture free to be a pure resume.
  `resume()` alone is still not enough for Safari: it wants a buffer actually
  played inside the gesture, so `unlock()` fires one silent sample too. The same
  measurement showed a whole drag producing only two unlock attempts, because
  `preventDefault()` on pointerdown suppresses the compat mousedown/mouseup/click
  a tap would otherwise add. Every voice is torn
  down on `ended`; Safari is slow to reclaim nodes still wired to the
  destination, and a long build otherwise leaves hundreds hanging off `master`.
  The concurrency cap is a list of scheduled end times rather than a counter,
  because a counter only decrements in `onended` — which never fires if the
  context parks mid-sound, so it leaks up to the cap and silences everything
  permanently. `unlock()` likewise never latches on a flag: it keeps running on
  every gesture until the context is genuinely playing, and if a context refuses
  to start after a few attempts it is closed and rebuilt inside the current
  gesture, since iOS can hand back one that will never start.
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

## Gemini

The key button sits top-right of the tray: red with no key, green once one is
saved. It opens a panel for the key and a model picker. The model list is
*fetched* from the API rather than hard-coded, so it is whatever that key can
actually use, filtered to models supporting `generateContent`.

Two asks, both in the tray footer:

- **WHAT IS THIS?** sends a semantic snapshot of the board and asks for one
  sentence saying what it depicts. The reply lands in a bubble at the top of the
  screen for five seconds.
- **WHAT NEXT?** sends the same snapshot and asks for *the next small thing*:
  what it can see so far, then one addition that carries it a step further. It
  answers in words, not coordinates, and the person places it.

  The ambition has to be held down explicitly, and the examples in the prompt do
  most of that work. An earlier version offered "a mouse for the cat to chase, a
  boat for the lake, a friend to stand beside it" — three new *subjects* — and it
  duly answered two black dots with "draw a rabbit next to it". The examples are
  now all increments (eyes want a nose, a wall wants a door, a roofline wants a
  chimney), the ask is capped at one to three pieces, the prompt says outright
  that this is a blunt tool with every piece placed by hand, and a brand new
  subject is only allowed on a nearly bare board. A rule forbidding "faces" also
  had to go: it was quietly fighting exactly the suggestion that was wanted.

  This replaced a version that asked Gemini to *place* up to 30 pieces itself.
  That was the wrong job to give it. Even with the geometry described exactly and
  the coordinate labels corrected, laying out a recognisable picture on a 16x16
  grid is a spatial task it is weak at, and the results read as noise. Suggesting
  is a task it is good at, and it leaves the building — the fun part — with the
  person. The placement plumbing is in the history if it is ever wanted back.

  Hints are **one running conversation**, so it builds on what it already said
  rather than starting cold. Two things keep that cheap: only the turn actually
  being sent carries the board, and what is kept in the history is a one-line
  note of what the board looked like at the time — otherwise every past turn
  would drag a whole map along behind it. Four exchanges are kept, then the
  oldest falls off, and CLEAR ends the conversation, since otherwise it carries
  on discussing a build that no longer exists.

  It is also told **what changed since it last spoke** — "since your last idea
  they have added 2 blue" — which is the most interesting thing that can have
  happened between two hints and costs nothing to work out locally. That is what
  lets it notice you took its advice.

  A failed call commits nothing, so a rate limit or a dropped connection cannot
  leave a dangling user turn and break the alternation on the next ask.

Neither ask can touch the board: both only ever produce a sentence, so there is
no path at all from a model reply into the grid.

`sceneSummary()` is the interesting half, and it is built around one idea: a
16x16 board of coloured pieces is far closer to **pixel art than architecture**,
so hand over the picture, not the parts list.

**Cost.** The payload is one character per stud with no separators, the relief
grid is only sent when something actually stands above one brick, and the
per-piece list is gone — the maps already say everything it said. That is ~1.8k
characters for describe and ~3.0k for finish, down from 4.1k and 5.3k. Describe
also runs with `thinkingBudget: 0`, since a fourteen-word answer needs no
reasoning tokens and 2.5 bills them as output; the guard is narrow because only
the flash models accept a zero budget, and finish keeps its thinking where it
earns its cost.

It renders two top-down grids. The first is what the board actually looks like
from above — one cell per stud, two-letter colour codes, `..` for bare plate,
with overhangs resolving to whatever is on top exactly as an eye would see them.
The second is relief: how high each cell stands, so height reads as emphasis
laid over the drawing rather than as a separate structure. The piece list and
the derived extent/colour tally follow for precision.

Both prompts are framed to match: describe reads the map like pixel art or a
painted sign, and finish completes a *drawing* — extend bands of colour to the
edges, fill regions meant to be solid, close outlines, complete symmetry — with
an explicit instruction to keep nearly everything flat and only raise what
genuinely stands proud. Aiming at a flat picture also happens to be the easier
thing to get right, so the plans come back cleaner.

**The key lives in `localStorage`.** That is the normal shape for a client-only
prototype and it is what makes this work with no backend — but be clear-eyed:
anyone with the kiosk, or its devtools, can read that key, and every request
carries it from the device. Fine on your own hardware; for anything public the
call belongs behind a server you own. The key is sent as an `x-goog-api-key`
header rather than a query parameter, so it stays out of URLs and logs.

**This needs network access, so it does not work inside a published Claude
artifact** — that page has a strict CSP that blocks external hosts. Use the
GitHub Pages URL or `npm run dev`.

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
