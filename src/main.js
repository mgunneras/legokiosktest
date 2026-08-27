import * as THREE from '../vendor/three.module.js';

/* =========================================================================
   Brick Kiosk — multi-touch 3D build prototype
   1 world unit = 1 stud pitch (8mm). Plate = 0.4u, brick = 3 plates = 1.2u.
   ========================================================================= */

const GRID       = 16;            // 16 x 16 baseplate
const PLATE      = 0.4;           // plate height in world units
const STUD_R     = 0.30;
const STUD_H     = 0.225;
const MAX_STACK  = 30;            // plates
const GAP        = 0.02;          // visual seam between bricks
const FALL_G     = 0.024;         // drop acceleration, in fractions of the gap/frame²

/* ---------- flick physics (world units / second) ---------- */
const GRAVITY    = 120;           // not real gravity: 1u = 8mm, so 9.81m/s² is
                                  // ~1226u/s² and the arc would be over instantly
/* Tracked hand speed and launch speed are different scales. A hand crossing the
   hover plane clocks ~19u/s on an ordinary drag and ~110 on a real flick, but a
   brick only wants to travel a few studs — so the throw is a scaled-down,
   clamped version of the hand, not the hand itself. */
const FLICK_MIN   = 14;           // hand speed below this is a drop, not a throw
const FLICK_SCALE = 0.22;
const FLICK_SLOW  = 11;           // gentlest throw: a nudge, ~2 studs
const FLICK_FAST  = 40;           // hardest: ~10 studs, and easy to overshoot
const FLICK_LIFT  = 0.30;         // fraction of speed added upward, to make an arc.
                                  // Carries more of the arc than it used to, because
                                  // the hand now hovers low and the drop height no
                                  // longer does that work — same throw, less height
const CRASH_ODDS  = 0.2;          // one in five is a dud, as asked
const ESCAPE      = 24;           // outward kick on a botched landing
const ESCAPE_SOFT = 9;            // ...and a gentler one, to shed onto the table
const TABLE_Y     = -PLATE - 0.005;   // the desk the baseplate sits on
const TABLE_R     = GRID * 1.25 - 1;  // ...as far as a brick can come to rest
const HOLD_MS     = 300;          // press-and-hold before a brick comes loose
const HOLD_SLOP   = 7;            // px of travel that turns a hold into an orbit
const DOUBLE_MS   = 340;
const CHUCK_UP    = 30;           // double-tap launch speed; apex ~4-7u, not ~1
const DEMO_GAP    = 0.08;         // seconds between bricks when CLEAR goes off
const FLIGHT_MAX = 8;             // seconds before a stray brick is reclaimed

/* ---------- palette ---------- */
const C = {
  red:'#c4281c', blue:'#0d5cb6', yellow:'#f5cd2f', green:'#237841',
  white:'#f2f3f2', grey:'#a0a5a9', black:'#2b2f33', orange:'#e07923',
  tan:'#d9bb7c', lime:'#a5ca18', azure:'#57a0d3', purple:'#81007b',
};
// w = studs along X, d = studs along Z, p = height in plates
const CATALOG = [
  { id:'b1x1', w:1, d:1, p:3, c:C.red },
  { id:'b1x2', w:2, d:1, p:3, c:C.blue },
  { id:'b1x3', w:3, d:1, p:3, c:C.yellow },
  { id:'b1x4', w:4, d:1, p:3, c:C.green },
  { id:'b1x6', w:6, d:1, p:3, c:C.orange },
  { id:'b1x8', w:8, d:1, p:3, c:C.purple },
  { id:'b2x2', w:2, d:2, p:3, c:C.white },
  { id:'b2x3', w:3, d:2, p:3, c:C.azure },
  { id:'b2x4', w:4, d:2, p:3, c:C.grey },
  { id:'b2x6', w:6, d:2, p:3, c:C.lime },
  { id:'p2x2', w:2, d:2, p:1, c:C.tan },
  { id:'p2x4', w:4, d:2, p:1, c:C.black },
];
const label = b => `${b.d}x${b.w}${b.p === 1 ? ' plate' : ''}`;

/* =========================== scene =========================== */
const canvas   = document.getElementById('gl');
const stageEl  = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* Daylight. Background and fog must stay the same colour or the fog ends in a
   visible band at the horizon. Not pure white — the plate needs something to
   sit against, and a faintly cool sky keeps the green and the primaries honest. */
const SKY = '#e8eef7';
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 62, 108);

const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 200);
const TARGET = new THREE.Vector3(0, 1.2, 0);

/* The ground half of the hemisphere light is the big change: it was a dark
   slate standing in for an unlit room, and it's what made every downward face
   read as dusk. Bouncing light off a bright floor instead lifts the undersides,
   so intensity comes *down* a little — the room is doing more of the work. */
scene.add(new THREE.HemisphereLight('#ffffff', '#ccd8e8', 1.28));
const sun = new THREE.DirectionalLight('#fffdf6', 1.62);
sun.position.set(9, 16, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.radius = 2;
const sc = sun.shadow.camera;
sc.left = -21; sc.right = 21; sc.top = 21; sc.bottom = -21; sc.near = 1; sc.far = 52;
scene.add(sun);
const rim = new THREE.DirectionalLight('#a9c6ee', 0.34);
rim.position.set(-8, 6, -9);
scene.add(rim);

/* ---------- shared geometry ---------- */
const studGeo = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 14);
const boxGeo  = new THREE.BoxGeometry(1, 1, 1);
const edgeGeo = new THREE.EdgesGeometry(boxGeo);   // for the press highlight
const matCache = new Map();
function brickMat(hex, ghost = false) {
  const key = hex + (ghost ? '_g' : '');
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshPhongMaterial({
      color: hex, shininess: 46, specular: '#2a2a2a',
      transparent: ghost, opacity: ghost ? 0.55 : 1, depthWrite: !ghost,
    }));
  }
  return matCache.get(key);
}

/* =========================== sound =========================== */
/* Procedural — no asset files, nothing to fetch. A short filtered-noise tick
   (the plastic clack) over a pitched blip that rises with the stack height. */
let actx = null, master = null, noiseBuf = null;
let tries = 0;                      // gestures spent trying to get sound going

function buildCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  const c = new AC();
  master = c.createGain();
  master.gain.value = 0.45;
  master.connect(c.destination);
  const n = Math.floor(c.sampleRate * 0.05);
  noiseBuf = c.createBuffer(1, n, c.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
  return c;
}

/* Built up front, deliberately outside any gesture. Measured on iPad Safari:
   a context created and resumed inside the *same* gesture stays suspended, and
   only starts on a later gesture that resumes an already-existing one. Spending
   the first touch on construction is what made sound appear only once you
   happened to tap a tool button afterwards. Constructing here costs nothing —
   the context is born suspended either way — and leaves every gesture free to
   be a pure resume. */
try { actx = buildCtx(); } catch { actx = false; }

/* Runs on every gesture, and keeps running until the context is genuinely
   playing — never latches on a flag, because a context can be parked again
   later by an interruption and would then never be recovered.               */
function unlock() {
  if (actx && actx.state === 'running') return;
  tries++;
  if (!actx) {
    actx = buildCtx();
    if (!actx) return;
  } else if (tries > 3) {
    // iOS can hand back a context that will never start — typically one built
    // during a gesture it decided not to honour. Retrying resume() on a dead
    // context gets nowhere, so give up on it and build a fresh one inside
    // *this* gesture, which is definitely a real activation.
    try { actx.close(); } catch {}
    actx = buildCtx();
    tries = 1;
    if (!actx) return;
  }
  // iOS does not treat resume() on its own as permission to make noise; it
  // wants a buffer actually played from inside the gesture.
  try {
    const src = actx.createBufferSource();
    src.buffer = actx.createBuffer(1, 1, actx.sampleRate);
    src.connect(actx.destination);
    src.start(0);
  } catch {}
  try {
    const p = actx.resume();        // not a promise on older webkit builds
    if (p && p.then) p.catch(() => {});
  } catch {}
}
/* Several event types on purpose: iOS honours some gestures and not others,
   and the palette and the tools both call preventDefault() on pointerdown,
   which suppresses the compat events a tap would otherwise produce.         */
for (const t of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mouseup', 'click', 'keydown'])
  addEventListener(t, unlock, { capture: true, passive: true });
const audioState = () => actx === false ? 'unsupported'
                       : !actx          ? 'idle'
                       : `${actx.state}/${tries}`;

function audio() {
  if (!actx) return null;
  // Not just 'suspended': iOS parks a context in a non-standard 'interrupted'
  // state after a call or a tab switch, and checking 'suspended' alone never
  // recovers from it. Nothing scheduled on a parked context ever runs, so its
  // `onended` never fires and the voice count would saturate and mute the app
  // for good — play nothing until it is genuinely running.
  if (actx.state !== 'running') { actx.resume().catch(() => {}); return null; }
  return actx;
}

/* Each sound builds a throwaway graph wired to `master`. Safari is slow to
   reclaim AudioNodes still connected to the destination, so a few hundred
   clicks leaves a few hundred dead chains hanging off it and the audio starts
   dropping out — exactly what a long build does. Tear the chain down when the
   source ends, and cap how many can be alive at once.

   The cap is a list of scheduled end times, not a counter. A counter only goes
   back down in `onended`, which never fires if the context is parked mid-sound
   — so it leaks, hits the cap, and silences everything permanently with no way
   back. Times simply expire.                                                */
const live = [];
const MAX_VOICES = 14;
function play(src, chain, t, stopAt) {
  const now = actx.currentTime;
  for (let i = live.length - 1; i >= 0; i--) if (live[i] <= now) live.splice(i, 1);
  if (live.length >= MAX_VOICES) return;
  live.push(stopAt);
  src.onended = () => { for (const n of chain) { try { n.disconnect(); } catch {} } };
  src.start(t);
  src.stop(stopAt);
}

function popSound(level) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.001;
  // High and over almost before it starts. A low body with a long fall is what
  // made this read as a gunshot; a stud going home is a tiny hard tick.
  const f = Math.min(1750 * Math.pow(1.03, level), 3200) * (0.97 + Math.random() * 0.06);

  const osc = a.createOscillator(), og = a.createGain();   // the click body
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f, t);
  osc.frequency.exponentialRampToValueAtTime(f * 0.86, t + 0.03);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.32, t + 0.003);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);
  osc.connect(og).connect(master);
  play(osc, [osc, og], t, t + 0.05);

  const src = a.createBufferSource(), bp = a.createBiquadFilter(), ng = a.createGain();
  src.buffer = noiseBuf;                                   // the plastic transient
  bp.type = 'highpass'; bp.frequency.value = 4200;
  ng.gain.setValueAtTime(0.15, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.016);
  src.connect(bp).connect(ng).connect(master);
  play(src, [src, bp, ng], t, t + 0.02);
}

/* Coming loose, and being thrown away — the same sweep run in both directions,
   so they're obviously a pair and obviously not the seating pop.            */
function pluckSound(up) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.001;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(up ? 260 : 720, t);
  o.frequency.exponentialRampToValueAtTime(up ? 720 : 240, t + 0.11);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g).connect(master);
  play(o, [o, g], t, t + 0.17);
}

/* Can't do that: a short buzzy two-step down. Deliberately the ugliest sound
   here — square wave, low, dissonant against the rest.                      */
function nope() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.001;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(150, t);
  o.frequency.setValueAtTime(104, t + 0.055);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.17, t + 0.008);
  g.gain.setValueAtTime(0.17, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  o.connect(g).connect(master);
  play(o, [o, g], t, t + 0.14);
}

/* A botched landing: duller and broader than the pop, no pitched body — it
   reads as a scuff rather than a click, which is the whole point.            */
function clatter() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.001;
  const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noiseBuf;
  bp.type = 'bandpass'; bp.frequency.value = 850 + Math.random() * 550; bp.Q.value = 0.8;
  g.gain.setValueAtTime(0.30, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  src.connect(bp).connect(g).connect(master);
  play(src, [src, bp, g], t, t + 0.1);
}

/* =========================== impact springs =========================== */
/* A spring for the board only — bricks never deform, see `land()`. Damped
   hard enough to read as a knock (one dip, one small rebound) rather than a
   wobble. `y` is the offset from rest; kick it by shoving `v`.              */
function spring(s, k = 0.55, c = 0.62) {
  s.v += -k * s.y - c * s.v;
  s.y += s.v;
  return Math.abs(s.y) > 1e-4 || Math.abs(s.v) > 1e-4;
}
const boardY = { y: 0, v: 0 };   // the whole board dips when a brick clicks in

/* builds a brick as a Group: body box + studs. Origin = footprint centre, y = base. */
function buildBrick(def, ghost = false, tintHex = null) {
  const g = new THREE.Group();
  const h = def.p * PLATE;
  const mat = brickMat(tintHex || def.c, ghost);

  const body = new THREE.Mesh(boxGeo, mat);
  body.scale.set(def.w - GAP, h, def.d - GAP);
  body.position.y = h / 2;
  body.castShadow = !ghost; body.receiveShadow = !ghost;
  g.add(body);

  for (let i = 0; i < def.w; i++) {
    for (let j = 0; j < def.d; j++) {
      const s = new THREE.Mesh(studGeo, mat);
      s.position.set(i - (def.w - 1) / 2, h + STUD_H / 2, j - (def.d - 1) / 2);
      s.castShadow = !ghost;
      s.raycast = () => {};                 // studs never block picking
      g.add(s);
    }
  }
  g.userData.pickBody = body;
  return g;
}

/* ---------- baseplate ---------- */
/* `build` holds the plate and everything placed on it, so the bounce moves the
   board and its bricks together. Y only — grid maths stays in world X/Z.     */
const build = new THREE.Group();
scene.add(build);
const plateGroup = new THREE.Group();
build.add(plateGroup);
{
  const base = new THREE.Mesh(boxGeo, new THREE.MeshPhongMaterial({ color:'#4e9f63', shininess:24 }));
  base.scale.set(GRID, PLATE, GRID);
  base.position.y = -PLATE / 2;
  base.receiveShadow = true;
  base.userData.isBase = true;
  plateGroup.add(base);

  const inst = new THREE.InstancedMesh(studGeo, new THREE.MeshPhongMaterial({ color:'#59ae72', shininess:24 }), GRID * GRID);
  inst.receiveShadow = true;
  inst.raycast = () => {};
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++)
      inst.setMatrixAt(n++, m.makeTranslation(i - GRID/2 + .5, STUD_H/2, j - GRID/2 + .5));
  plateGroup.add(inst);

  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(GRID * 1.25, GRID * 1.25, 0.05, 72),
    new THREE.MeshBasicMaterial({ color:'#d5deec' })
  );
  skirt.position.y = -PLATE - 0.03;
  plateGroup.add(skirt);
}

/* ---------- world state ---------- */
const heights = new Int16Array(GRID * GRID);      // stacked height per column, in plates
/* A brick is in exactly one of these at a time. `placed` is the build: seated,
   grid-aligned, part of `heights`. `loose` is the desk: resting where it fell,
   at whatever angle, in no grid at all. `flying` is neither — in the air, owned
   by the simulation, and committed to one of the other two (or to nothing) when
   it comes down. */
const placed  = [];                               // { g, def, sol, rot, kind }
const loose   = [];                               // { g, def, kind } — on the desk
const flying  = [];                               // bricks mid-air
const pickList = [];                              // what a finger can press on
const hitList = [];                               // meshes eligible for raycast
plateGroup.traverse(o => { if (o.isMesh && o.userData.isBase) hitList.push(o); });

const H = (i, j) => heights[j * GRID + i];
const setH = (i, j, v) => { heights[j * GRID + i] = v; };
const drop1 = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); };

/* Replayed in placement order, because each brick's `sol.h` was resolved against
   the state at the time it landed. Safe to rebuild after a removal only because
   nothing can be removed while something rests on it — see `isFree`.          */
function rebuildHeights() {
  heights.fill(0);
  for (const p of placed)
    for (let i = p.sol.i0; i < p.sol.i0 + p.sol.w; i++)
      for (let j = p.sol.j0; j < p.sol.j0 + p.sol.d; j++) setH(i, j, p.sol.h + p.def.p);
}
/* Nothing on top: every column under the footprint tops out at this brick. */
function isFree(rec) {
  if (rec.kind === 'loose') return true;
  const s = rec.sol, top = s.h + rec.def.p;
  for (let i = s.i0; i < s.i0 + s.w; i++)
    for (let j = s.j0; j < s.j0 + s.d; j++) if (H(i, j) !== top) return false;
  return true;
}
/* Out of whichever world it was in, and out of every list that referenced it. */
function detach(rec) {
  if (rec.kind === 'placed') { drop1(placed, rec); rebuildHeights(); }
  else                       { drop1(loose, rec); }
  drop1(hitList, rec.g.userData.pickBody);
  drop1(pickList, rec.g.userData.pickBody);
  build.remove(rec.g);
}

/* =========================== camera rig =========================== */
const view = { az: -0.7, pol: 0.92, rad: 34, taz: -0.7, tpol: 0.92, trad: 34 };
const HOME = { az: -0.7, pol: 0.92, rad: 34 };
const POL_MIN = 0.30, POL_MAX = 1.40;            // ~17° (top-down-ish) .. ~80° (near horizon)
const RAD_MIN = 12,  RAD_MAX = 56;

/* The lamp belongs to the room, not to the board. The board is static in world
   space and the camera is what orbits, so a world-fixed light stays fixed
   *relative to the board* and its shadows never move — you're walking around a
   lit table. Carrying the lights around with the azimuth pins them to the
   viewer instead, so the model turns underneath them and the shadows sweep:
   a baseboard spun on a workbench. Offsets are measured from the home view, so
   the default framing is lit exactly as it was. */
const SUN = { r: Math.hypot(9, 7),  y: 16, off: Math.atan2(9, 7)   - HOME.az };
const RIM = { r: Math.hypot(8, 9),  y:  6, off: Math.atan2(-8, -9) - HOME.az };
function placeLights() {
  const a = view.az + SUN.off, b = view.az + RIM.off;
  sun.position.set(SUN.r * Math.sin(a), SUN.y, SUN.r * Math.cos(a));
  rim.position.set(RIM.r * Math.sin(b), RIM.y, RIM.r * Math.cos(b));
}

function applyCamera() {
  view.az  += (view.taz  - view.az)  * 0.2;
  view.pol += (view.tpol - view.pol) * 0.2;
  view.rad += (view.trad - view.rad) * 0.2;
  const s = Math.sin(view.pol);
  camera.position.set(
    TARGET.x + view.rad * s * Math.sin(view.az),
    TARGET.y + view.rad * Math.cos(view.pol),
    TARGET.z + view.rad * s * Math.cos(view.az)
  );
  camera.lookAt(TARGET);
  camera.updateMatrixWorld();   // keep raycasts in sync with the damped camera
  placeLights();                // ...and the lamp with it
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* =========================== pointer routing =========================== */
/* Every pointer is independently owned by either the navigator (stage) or a
   drag session (menu). One hand can orbit while the other drags a brick.      */
const nav   = new Map();   // pointerId -> {x,y}
const drags = new Map();   // pointerId -> {def, tile, held, ghost, sol, rot, az0}
let pinch = null;          // {dist, rad, mx, az}
let manualRot = 0;         // optional 90° offset; the plate's angle does the rest
let flickOn = true;        // throwing; F turns it off, there is no button
let selected = 0;

/* ---------- navigation (stage) ---------- */
stageEl.addEventListener('pointerdown', e => {
  unlock();
  try { stageEl.setPointerCapture(e.pointerId); } catch {}
  if (castFrom(e.clientX, e.clientY)) {           // did it land on a brick?
    const hit = ray.intersectObjects(pickList, false)[0];
    if (hit && hit.object.userData.owner) startHold(e, hit.object.userData.owner);
  }
  nav.set(e.pointerId, { x:e.clientX, y:e.clientY });
  if (nav.size === 2) startPinch();
});
function moveNav(e) {
  const p = nav.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;

  if (nav.size === 1) {                                   // one finger: orbit
    view.taz  -= dx * 0.006;
    view.tpol  = clamp(view.tpol - dy * 0.006, POL_MIN, POL_MAX);
  } else if (nav.size === 2 && pinch) {                   // two fingers: zoom + spin
    const [a, b] = [...nav.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx   = (a.x + b.x) / 2;
    view.trad = clamp(pinch.rad * (pinch.dist / Math.max(dist, 1)), RAD_MIN, RAD_MAX);
    view.taz  = pinch.az - (mx - pinch.mx) * 0.004;
  }
}
function endNav(e) {
  if (!nav.delete(e.pointerId)) return;
  pinch = null;
  if (nav.size === 2) startPinch();
}
function startPinch() {
  const [a, b] = [...nav.values()];
  pinch = { dist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), rad: view.trad, mx: (a.x + b.x) / 2, az: view.taz };
}


/* =========================== placement solving =========================== */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
/* These stack: HOVER lifts the brick above the surface it would land on, then
   LIFT pushes it further along the camera's up axis, so the felt gap is roughly
   HOVER - brickHeight/2 + LIFT*0.8 — which at the old 2.6/1.5 was over three
   brick heights. Close enough now to read as holding it just off the studs. */
const HOVER = 1.05;                                 // how high a held brick floats
const LIFT  = 0.5;                                  // ...and how far above the fingertip
const hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpV = new THREE.Vector3(), camUp = new THREE.Vector3(), flingV = new THREE.Vector3();

/* aim `ray` at a screen point — false if that point isn't over the 3D stage */
function castFrom(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return true;
}

/* where does a footprint centred on this point land? `build` has no x/z offset,
   so world and board coordinates agree on the two axes that matter here.     */
function solveAt(px, pz, def, rot) {
  const w = rot ? def.d : def.w;
  const d = rot ? def.w : def.d;
  const i0 = clamp(Math.round(px + GRID / 2 - w / 2), 0, GRID - w);
  const j0 = clamp(Math.round(pz + GRID / 2 - d / 2), 0, GRID - d);

  // Rest on the highest column under the footprint. Overhang is allowed — a
  // real brick juts out over air happily as long as some studs grip it — which
  // is what lets you stagger courses and build upwards. Nothing can intersect:
  // every column is at or below `h`, and the brick starts at `h`.
  let h = 0;
  for (let i = i0; i < i0 + w; i++)
    for (let j = j0; j < j0 + d; j++) h = Math.max(h, H(i, j));
  const ok = h + def.p <= MAX_STACK;
  return { i0, j0, w, d, h, ok };
}
/* ...and where does the brick under `ray` land? null if it misses the build */
function solveRay(def, rot) {
  const hit = ray.intersectObjects(hitList, false)[0];
  if (!hit) return null;
  // nudge into the column we actually hit (side faces sit exactly on a seam)
  return solveAt(hit.point.x - hit.face.normal.x * 0.02,
                 hit.point.z - hit.face.normal.z * 0.02, def, rot);
}
const solve = (x, y, def, rot) => castFrom(x, y) ? solveRay(def, rot) : null;
const overBoard = p => Math.abs(p.x) <= GRID / 2 && Math.abs(p.z) <= GRID / 2;

const placeX = (i0, w) => i0 - GRID / 2 + w / 2;

/* =========================== press and hold =========================== */
/* Press a brick and its edges light; keep pressing and it comes loose into your
   hand. A press that travels is an orbit instead, so the two never fight — the
   hold is abandoned the moment the finger moves more than a few pixels.      */
const holds = new Map();        // pointerId -> { rec, line, t0, x0, y0, x, y, blocked }
let lastTap = { rec: null, t: 0 };

function startHold(e, rec) {
  const blocked = !isFree(rec);
  const body = rec.g.userData.pickBody;
  // Depth-tested on purpose: drawing through the brick reads as an x-ray cage
  // rather than its edges lighting up. Nudged out just far enough to clear the
  // surface without z-fighting.
  const line = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
    color: blocked ? '#ff3b3b' : '#ffd21e', transparent: true, opacity: 0.35,
    depthWrite: false,
  }));
  line.scale.copy(body.scale).multiplyScalar(1.03);
  line.position.copy(body.position);
  line.renderOrder = 2;
  rec.g.add(line);
  holds.set(e.pointerId, { rec, blocked, line, t0: performance.now(),
                           x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
}
function cancelHold(pid) {
  const h = holds.get(pid);
  if (!h) return;
  h.rec.g.remove(h.line);
  h.line.material.dispose();
  holds.delete(pid);
}
function tickHolds(now) {
  for (const [pid, h] of holds) {
    const t = Math.min((now - h.t0) / HOLD_MS, 1);
    h.line.material.opacity = 0.35 + t * 0.65;    // the edges brighten as it loosens
    if (t < 1) continue;
    if (!h.blocked) liftBrick(pid, h);
    else if (!h.buzzed) { h.buzzed = true; nope(); }   // held long enough to mean it
  }
}
/* Straight from the build into the hand: same drag session a palette brick gets,
   seeded so it keeps the orientation it was sitting in.                      */
function liftBrick(pid, h) {
  const rec = h.rec;
  cancelHold(pid);
  nav.delete(pid);                                // this is a drag now, not an orbit
  pinch = null;
  const seed = rec.kind === 'placed' ? rec.rot : undefined;
  const def = rec.def;
  detach(rec);
  pluckSound(true);
  beginDrag({ pointerId: pid, clientX: h.x, clientY: h.y }, def, null, seed);
}
/* A press that neither travelled nor lasted is a tap; two of them chuck it. */
function tapHold(e) {
  const h = holds.get(e.pointerId);
  if (!h) return;
  const rec = h.rec, blocked = h.blocked;
  cancelHold(e.pointerId);
  const now = performance.now();
  if (lastTap.rec === rec && now - lastTap.t < DOUBLE_MS) {
    lastTap = { rec: null, t: 0 };
    blocked ? nope() : chuck(rec);
  } else {
    lastTap = { rec, t: now };
  }
}

/* =========================== drag sessions =========================== */
/* A held brick hangs off your finger in 3D and keeps the orientation it has in
   the air. Spinning the plate underneath turns the grid, not the brick — so it
   lands on whichever grid axis is nearest and you never reach for a button.   */
/* Which way round a *fresh* brick sits in your hand. The library draws every
   piece long-side-across, so it should leave the library looking the same — but
   a footprint is defined in world axes, and which world axis reads as "across
   the screen" depends on where the camera is. Project the two: world X lands on
   screen along (cos az, -sin az·cos pol) and world Z along (-sin az, -cos az·cos
   pol). Comparing which is flatter reduces to |sin az| vs |cos az| — the tilt
   divides out, so only the azimuth matters and a top-down view is no different
   from a low one. */
function screenParity(def) {
  const xReadsFlatter = Math.abs(Math.cos(view.az)) >= Math.abs(Math.sin(view.az));
  const longSideIsX   = def.w >= def.d;
  return longSideIsX === xReadsFlatter ? 0 : 1;
}
/* Signed and accumulating, so spinning the plate keeps winding the brick the
   same way instead of flipping it back and forth. A footprint only cares about
   the parity; the held brick cares about the whole turn count, because that is
   what lets it be twisted rather than swapped. */
function gridTurns(s) {
  return s.rot0 + manualRot + Math.round((view.az - s.az0) / (Math.PI / 2));
}
const gridRot = s => gridTurns(s) & 1;

function beginDrag(e, def, srcEl, seedRot) {
  // A pointer id gets reused — a mouse is always id 1 — so a session that was
  // somehow left open would be overwritten here and orphan its tile and brick
  // in the scene with nothing left holding a reference to them.
  const stale = drags.get(e.pointerId);
  if (stale) closeDrag(stale, e.pointerId);

  let tile = null;                                // a brick lifted off the build is
  if (srcEl) {                                    // already in 3D — no chip needed
    tile = document.createElement('div');         // stand-in while over the menu
    tile.className = 'tile';
    tile.appendChild(srcEl.querySelector('.swatch').cloneNode(true));
    document.getElementById('chips').appendChild(tile);
  }
  // Baseline set once, at pickup. `steps` still turns the brick against the
  // grid as the plate spins under it, so the pickup orientation moves with the
  // camera without disturbing that.
  const s = { def, tile, src:srcEl, x:e.clientX, y:e.clientY, az0:view.az,
              rot0: seedRot === undefined ? screenParity(def) : ((seedRot - manualRot) & 1),
              held:null, ghost:null, rot:-1, sol:null, yaw:0, yawTo:0,
              vel:new THREE.Vector3(), lastPos:new THREE.Vector3(), lastT:0 };
  drags.set(e.pointerId, s);
  refreshDrag(s);
}
function moveDrag(e, s) {
  s.x = e.clientX; s.y = e.clientY;
  refreshDrag(s);
}
/* Re-run for every live drag each frame: the plate turning under a still
   finger changes both where the brick lands and which way round it sits.     */
function refreshDrag(s) {
  const over = castFrom(s.x, s.y);

  if (s.tile) {
    s.tile.style.left = s.x + 'px';
    s.tile.style.top  = s.y + 'px';
    s.tile.style.display = over ? 'none' : 'block'; // 3D takes over on the stage
  }

  const turns = gridTurns(s), rot = turns & 1;
  if (!s.held) {                                    // built once, then only turned
    s.held = buildBrick(s.def);                     // solid — this is the one in your hand
    scene.add(s.held);
    s.yaw = turns * (Math.PI / 2);
  }
  // The hand twists; it doesn't teleport. The ghost still snaps, because it is
  // answering "where does this land", not "what is my hand doing".
  s.yawTo = turns * (Math.PI / 2);
  s.yaw += (s.yawTo - s.yaw) * 0.32;
  s.held.rotation.y = s.yaw;
  if (rot !== s.rot) {                              // snapped to the other grid axis
    if (s.ghost) build.remove(s.ghost);
    s.ghost = buildBrick(rot ? { ...s.def, w:s.def.d, d:s.def.w } : s.def, true);
    build.add(s.ghost);                             // sticks to the board, bounce and all
    s.rot = rot;
  }

  const sol = over ? solveRay(s.def, rot) : null;
  s.sol = sol;

  s.held.visible = over;
  if (over) {                                       // hang the brick under the finger
    const hh = s.def.p * PLATE;
    const y  = (sol ? sol.h * PLATE : 0) + HOVER;
    hoverPlane.constant = -y;
    if (ray.ray.intersectPlane(hoverPlane, tmpV)) {
      // sit just above the fingertip, so the finger and the brick don't hide
      // the landing ghost directly beneath them on the same screen ray
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      s.held.position.set(tmpV.x, y - hh / 2, tmpV.z).addScaledVector(camUp, LIFT);
    }
    // Velocity comes off the brick's own world position, not the screen, so a
    // throw already accounts for the camera. Smoothed, and refreshDrag runs
    // every frame — so a finger that stops moving decays to nothing within a
    // few frames and a still release is a drop, never a throw.
    const t = performance.now();
    if (s.lastT) {
      const dt = (t - s.lastT) / 1000;
      if (dt > 0.001) s.vel.lerp(flingV.subVectors(s.held.position, s.lastPos).divideScalar(dt), 0.4);
    }
    s.lastT = t;
    s.lastPos.copy(s.held.position);
  } else {
    s.lastT = 0;                                    // re-entering shouldn't read as speed
    s.vel.set(0, 0, 0);
  }

  s.ghost.visible = !!sol;
  if (!sol) return;
  s.ghost.position.set(placeX(sol.i0, sol.w), sol.h * PLATE, placeX(sol.j0, sol.d));
  const tint = sol.ok ? null : '#ff3b3b';
  s.ghost.traverse(o => { if (o.isMesh) o.material = brickMat(tint || s.def.c, true); });
}
/* Every way a session can end funnels through here, so nothing it owns — the
   menu tile, the held brick, the ghost — can outlive it.                     */
function closeDrag(s, id) {
  drags.delete(id);
  if (s.ghost) build.remove(s.ghost);
  if (s.held)  scene.remove(s.held);
  if (s.tile) s.tile.remove();
  if (s.src)  s.src.classList.remove('press');
}
function endDrag(e) {                       // released: throw it, or drop it if it fits
  const s = drags.get(e.pointerId);
  if (!s) return;
  const from  = s.held.visible ? s.held.position.clone() : null;   // closeDrag frees it
  const thrown = flickOn && from && s.vel.length() >= FLICK_MIN;
  const vel = s.vel.clone(), { def, sol, rot } = s;
  closeDrag(s, e.pointerId);
  if (thrown)              launch(def, rot, from, vel);
  else if (sol && sol.ok)  place(def, sol, rot, from);
  else if (from)           discard(def, rot, from, vel);   // off the build: onto the desk
}
function abortDrag(e) {                     // cancelled, not released: drop nothing
  const s = drags.get(e.pointerId);
  if (s) closeDrag(s, e.pointerId);
}
function abortAllDrags() {
  for (const [id, s] of drags) closeDrag(s, id);
  for (const id of [...holds.keys()]) cancelHold(id);
}
/* Seat a brick in the grid for good. Both a dropped brick and one that sticks
   its landing come through here, so they end up identically undoable.        */
function commit(g, def, sol, rot) {
  const base = new THREE.Vector3(placeX(sol.i0, sol.w), sol.h * PLATE, placeX(sol.j0, sol.d));
  g.position.copy(base);
  g.rotation.set(0, 0, 0);
  build.add(g);
  hitList.push(g.userData.pickBody);
  for (let i = sol.i0; i < sol.i0 + sol.w; i++)
    for (let j = sol.j0; j < sol.j0 + sol.d; j++) setH(i, j, sol.h + def.p);
  const p = { g, def, sol, rot, base, anim: null, kind: 'placed' };
  g.userData.pickBody.userData.owner = p;
  pickList.push(g.userData.pickBody);
  placed.push(p);
  return p;
}
const turned = (def, rot) => rot ? { ...def, w:def.d, d:def.w } : def;

function place(def, sol, rot, from) {
  const p = commit(buildBrick(turned(def, rot)), def, sol, rot);
  // fall into the socket from wherever the hand released it (`from` is world,
  // `base` is board-local — they differ by however far the board is bouncing)
  const off = from ? from.clone().sub(p.base) : new THREE.Vector3(0, 0.9, 0);
  if (from) off.y -= build.position.y;
  p.g.position.copy(p.base).add(off);
  p.anim = { off, t: 0, v: 0.015 };
}
/* the click. Fires when it actually touches down, not when the finger let go.
   The brick itself does nothing — ABS doesn't squash, so the energy goes into
   the board instead, which is what you'd feel through a real baseplate.     */
function land(p) {
  const studs = p.sol.w * p.sol.d;
  boardY.v -= Math.min(0.066 + studs * 0.014, 0.20);    // bigger brick, bigger thud
  popSound(p.sol.h + p.def.p);
  navigator.vibrate?.(12);
}
/* ---------- the flick ---------- */
/* Whether a throw sticks is decided here, at launch, not on arrival — a dud is
   committed to before it ever touches down, so it tumbles the whole way in. */
function launch(def, rot, from, vel) {
  const g = buildBrick(turned(def, rot));
  g.position.copy(from);
  g.position.y -= build.position.y;             // world -> board-local
  build.add(g);
  const speed = clamp(vel.length() * FLICK_SCALE, FLICK_SLOW, FLICK_FAST);
  vel.setLength(speed).y += speed * FLICK_LIFT;  // a little loft, so it arcs
  flying.push({ g, def, rot, vel, spin:null, bounces:0, age:0,
                sticks: Math.random() >= CRASH_ODDS });
}

/* A landing that doesn't take: kick it away from the middle of the board so it
   can't settle back down, and give it a tumble it never recovers from.       */
function botch(f, top, kick = ESCAPE, lift = 18) {
  const p = f.g.position;
  p.y = top + 0.001;
  f.bounces++;
  f.sticks = false;
  const out = new THREE.Vector3(p.x, 0, p.z);
  if (out.lengthSq() < 1) out.set(f.vel.x, 0, f.vel.z);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  out.normalize();
  f.vel.set(out.x * kick + f.vel.x * 0.25,
            Math.abs(f.vel.y) * 0.4 + lift,      // enough hang time to clear the board
            out.z * kick + f.vel.z * 0.25);
  f.spin = new THREE.Vector3((Math.random() * 2 - 1) * 7,
                             (Math.random() * 2 - 1) * 6,
                             (Math.random() * 2 - 1) * 7);
  boardY.v -= 0.05;
  clatter();
}

/* Released off the build: it doesn't vanish, it lands on the desk and stays
   there, at whatever angle it came to rest — no grid, no stack, still yours. */
function discard(def, rot, from, vel) {
  const g = buildBrick(turned(def, rot));
  g.position.copy(from);
  g.position.y -= build.position.y;
  build.add(g);
  const v = vel.clone().multiplyScalar(FLICK_SCALE * 0.6);
  if (v.length() > 14) v.setLength(14);
  flying.push({ g, def, rot, mode:'discard', vel:v, bounces:0, age:0, sticks:false,
                spin: new THREE.Vector3((Math.random() * 2 - 1) * 3,
                                        (Math.random() * 2 - 1) * 4,
                                        (Math.random() * 2 - 1) * 3) });
}
/* Double-tapped: off the table it goes. Launched as a throw that is already
   doomed, so the ordinary botch path carries it away.                        */
function chuck(rec, boost = 1) {
  const { g, def } = rec, rot = rec.rot || 0;
  detach(rec);
  build.add(g);
  // Straight up and radially out is tidy and dull. Scatter the heading either
  // side of "away from the middle" and give it a properly silly amount of
  // height, so no two go the same way and none of them look deliberate.
  const out = new THREE.Vector3(g.position.x, 0, g.position.z);
  if (out.lengthSq() < 1) out.set(1, 0, 0);
  out.normalize();
  const heading = Math.atan2(out.z, out.x) + (Math.random() - 0.5) * 1.3;
  const away    = (10 + Math.random() * 11) * boost;
  flying.push({ g, def, rot, mode:'throw', sticks:false, bounces:0, age:0,
                vel: new THREE.Vector3(Math.cos(heading) * away,
                                       (CHUCK_UP + Math.random() * 10) * boost,
                                       Math.sin(heading) * away),
                spin: new THREE.Vector3((Math.random() * 2 - 1) * 11,
                                        (Math.random() * 2 - 1) * 9,
                                        (Math.random() * 2 - 1) * 11) });
  pluckSound(false);
}
/* Coming to rest on the desk: each bounce flattens what is left of the tumble,
   so it is already lying flat by the time it stops and nothing has to snap. */
function tableBounce(f) {
  const p = f.g.position;
  p.y = TABLE_Y;
  f.bounces++;
  f.vel.y = -f.vel.y * 0.42;
  f.vel.x *= 0.6; f.vel.z *= 0.6;
  f.g.rotation.x *= 0.35; f.g.rotation.z *= 0.35;
  if (f.spin) f.spin.multiplyScalar(0.45);
  clatter();
  if (f.vel.y >= 2.2 && f.bounces < 3) return false;
  f.g.rotation.x = 0; f.g.rotation.z = 0;      // flat on the desk, yaw kept
  const rec = { g: f.g, def: f.def, kind: 'loose' };
  f.g.userData.pickBody.userData.owner = rec;
  pickList.push(f.g.userData.pickBody);         // pickable, but never stackable:
  loose.push(rec);                              // deliberately not in hitList
  return true;
}

/* A brick on its way off the table still has to deal with the table. It skips
   outward instead of settling, so a wider desk means a longer, sillier exit —
   never a brick sinking through the surface it should be bouncing on.       */
function skitter(f) {
  const p = f.g.position;
  p.y = TABLE_Y;
  f.bounces++;
  f.vel.y = Math.abs(f.vel.y) * 0.45 + 7;
  const out = new THREE.Vector3(p.x, 0, p.z);
  if (out.lengthSq() < 1) out.set(f.vel.x, 0, f.vel.z);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  out.normalize();
  f.vel.x = f.vel.x * 0.7 + out.x * 12;      // always gains ground outward, so it
  f.vel.z = f.vel.z * 0.7 + out.z * 12;      // is guaranteed to clear the edge
  clatter();
}

/* CLEAR doesn't tidy up, it detonates. One brick per beat rather than all at
   once, because a single frame where everything leaves is just a disappearance
   — the stagger is what makes it read as bam, bam, bam. Tallest first, so the
   build comes apart from the top instead of leaving pieces hanging in mid-air. */
const demolition = [];
let demoT = 0;
function demolish() {
  demolition.length = 0;
  demolition.push(...placed.slice().sort((a, b) =>
    (b.sol.h + b.def.p) - (a.sol.h + a.def.p)), ...loose.slice());
  demoT = 0;
}
function stepDemolition(dt) {
  if (!demolition.length) return;
  demoT -= dt;
  if (demoT > 0) return;
  demoT = DEMO_GAP;
  const rec = demolition.shift();
  if (rec && (placed.includes(rec) || loose.includes(rec))) chuck(rec, 1.25);
}

function stepFlight(dt) {
  for (let n = flying.length - 1; n >= 0; n--) {
    const f = flying[n];
    f.age += dt;
    f.vel.y -= GRAVITY * dt;
    f.g.position.addScaledVector(f.vel, dt);
    if (f.spin) {                                 // rigid tumble — still no squashing
      f.g.rotation.x += f.spin.x * dt;
      f.g.rotation.y += f.spin.y * dt;
      f.g.rotation.z += f.spin.z * dt;
    }

    const p = f.g.position;
    if (f.vel.y < 0) {
      if (overBoard(p)) {
        const sol = solveAt(p.x, p.z, f.def, f.rot);
        if (p.y <= sol.h * PLATE) {
          if (f.sticks && sol.ok) {
            land(commit(f.g, f.def, sol, f.rot));   // clicks in exactly like a drop
            flying.splice(n, 1);
            continue;
          }
          // a discard that came down over the build sheds sideways onto the desk
          f.mode === 'discard' ? botch(f, sol.h * PLATE, ESCAPE_SOFT, 7)
                               : botch(f, sol.h * PLATE);
        }
      } else if (p.y <= TABLE_Y && Math.hypot(p.x, p.z) <= TABLE_R) {
        if (f.mode === 'discard') { if (tableBounce(f)) { flying.splice(n, 1); continue; } }
        else skitter(f);
      }
    }
    if (p.y < -25 || f.age > FLIGHT_MAX) {        // gone off the table for good
      build.remove(f.g);
      flying.splice(n, 1);
    }
  }
}

function undo() {
  const last = placed[placed.length - 1];
  if (last) detach(last);
}

/* =========================== pointer routing =========================== */
/* Routed from the window, not from the element the pointer started on. An
   element only sees a pointer for as long as its capture holds, and a capture
   that is never acquired (the call is allowed to fail) or is lost mid-drag
   leaves the session with no way to ever end — the tile stays stuck to the
   palette and the held brick hangs over the plate for good. A capture still
   *helps*: it keeps delivering events when the pointer leaves the window. It
   just can't be the only thing the teardown depends on.                      */
addEventListener('pointermove', e => {
  const s = drags.get(e.pointerId);
  if (s) { moveDrag(e, s); return; }
  const h = holds.get(e.pointerId);
  if (h) {
    if (Math.hypot(e.clientX - h.x0, e.clientY - h.y0) > HOLD_SLOP) cancelHold(e.pointerId);
    else { h.x = e.clientX; h.y = e.clientY; }
  }
  moveNav(e);
});
addEventListener('pointerup',     e => { tapHold(e);            endDrag(e);   endNav(e); });
addEventListener('pointercancel', e => { cancelHold(e.pointerId); abortDrag(e); endNav(e); });
/* alt-tab, or a release outside the window, can swallow the pointerup outright */
addEventListener('blur', abortAllDrags);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) abortAllDrags();
});

/* =========================== menu =========================== */
const paletteEl = document.getElementById('palette');
CATALOG.forEach((def, idx) => {
  const el = document.createElement('div');
  el.className = 'brick' + (idx === 0 ? ' active' : '');
  const sw = document.createElement('div');
  sw.className = 'swatch';
  sw.style.background = def.c;
  sw.style.gridTemplateColumns = `repeat(${def.w}, var(--stud))`;
  for (let n = 0; n < def.w * def.d; n++) sw.appendChild(document.createElement('i'));
  const lb = document.createElement('div');
  lb.className = 'lbl';
  lb.textContent = label(def);
  el.append(sw, lb);
  paletteEl.appendChild(el);

  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    unlock();          // before the capture below: UNDO and CLEAR are the only
                       // paths that never capture a pointer, and they are also
                       // the only ones that reliably start sound on iPad
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('press');
    selected = idx;
    [...paletteEl.children].forEach((c, i) => c.classList.toggle('active', i === idx));
    beginDrag(e, def, el);
  });
});

const rotStateEl = document.getElementById('rotState');
const tap = (id, fn) => document.getElementById(id)
  .addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
tap('btnRotate', () => { manualRot ^= 1; rotStateEl.textContent = manualRot ? '90°' : '0°'; });
/* No button for this any more — throwing earned its place. F still toggles it,
   for when a flick needs ruling out while chasing something else.           */
const toggleFlick = () => { flickOn = !flickOn; };
tap('btnUndo', undo);
tap('btnClear', demolish);
tap('btnHome', () => { view.taz = HOME.az; view.tpol = HOME.pol; view.trad = HOME.rad; });
tap('btnFull', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') { manualRot ^= 1; rotStateEl.textContent = manualRot ? '90°' : '0°'; }
  if (e.key === 'z' || e.key === 'Z') undo();
  if (e.key === 'f' || e.key === 'F') toggleFlick();
});

/* =========================== start screen =========================== */
/* One plain tap, which is the one interaction iOS accepts as permission to
   make sound. Building never produces one: a drag calls preventDefault (which
   suppresses the compat click) and captures the pointer. Deliberately no
   preventDefault and no capture here — this listener is the same shape as the
   tool buttons, which are the only thing that ever unlocked audio on iPad. */
{
  const startEl = document.getElementById('start');
  let begun = false;
  const begin = () => {
    if (begun) return;
    begun = true;
    unlock();
    startEl.classList.add('gone');
    setTimeout(() => startEl.remove(), 400);
  };
  startEl.addEventListener('click', begin);
  startEl.addEventListener('touchend', begin);
  startEl.addEventListener('pointerup', begin);   // last resort on desktop
}

/* =========================== loop =========================== */
function resize() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const statsEl = document.getElementById('stats');
let fpsT = performance.now(), frames = 0;

let lastT = performance.now();
function tick(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);   // a throttled tab must not teleport
  lastT = now;
  applyCamera();
  for (const s of drags.values()) refreshDrag(s);   // plate may have moved under the finger
  if (spring(boardY)) build.position.y = boardY.y;                 // board rebound
  else if (build.position.y) { boardY.y = boardY.v = 0; build.position.y = 0; }
  for (const p of placed) {                        // dropping out of the hand
    const a = p.anim;
    if (!a) continue;
    a.v += FALL_G;                                 // accelerate in — a hard thing
    a.t += a.v;                                    // falling covers most of the
    if (a.t < 1) {                                 // gap in the last frame or two
      p.g.position.copy(p.base).addScaledVector(a.off, 1 - a.t);
      continue;
    }
    p.g.position.copy(p.base);                     // dead stop: no give, no rebound
    p.anim = null;
    land(p);
  }
  tickHolds(now);
  stepDemolition(dt);
  stepFlight(dt);
  renderer.render(scene, camera);
  if (++frames >= 30) {
    statsEl.textContent = `${Math.round(frames * 1000 / (now - fpsT))} fps · ${placed.length} bricks · ${drags.size + nav.size} touches · audio ${audioState()}`;
    fpsT = now; frames = 0;
  }
  requestAnimationFrame(tick);
}
applyCamera();
scene.updateMatrixWorld(true);   // valid camera + world matrices on frame 0 (raycasts can precede the first RAF)
requestAnimationFrame(tick);

/* kiosk hygiene */
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('gesturestart', e => e.preventDefault());
addEventListener('dblclick', e => e.preventDefault());

/* debug hook — handy on-site for poking state from devtools */
window.__kiosk = { placed, loose, flying, holds, pickList, heights, view, drags, nav, CATALOG, solve, hitList, camera, scene, build, ray, ndc, THREE, gridRot, gridTurns, popSound, boardY, solveAt, audioState, launch, stepFlight, stepDemolition, tickHolds, chuck, isFree, detach, demolish, demolition, get flickOn(){ return flickOn; }, get manualRot(){ return manualRot; } };
