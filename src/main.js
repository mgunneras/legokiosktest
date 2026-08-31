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
const DESK_R      = GRID * 1.45;      // the bench the baseplate is pushed around on
const TABLE_Y     = -PLATE - 0.005;   // the desk the baseplate sits on
const TABLE_R     = DESK_R - 1;       // ...as far as a brick can come to rest
/* The board may be shoved anywhere on the bench but never over the rim. Its
   worst corner is half a diagonal from the middle whichever way it has been
   spun, so a single radius covers every heading. */
const SLIDE_MAX   = DESK_R - Math.SQRT2 * GRID / 2;
/* Radius of gyration squared for a square plate, (w^2 + d^2)/12 — the number
   that decides how much of a one-fingered shove turns into spin. */
const RHO2        = (GRID * GRID + GRID * GRID) / 12;
const HOLD_MS     = 180;          // press-and-hold before a brick comes loose
const HOLD_SLOP   = 7;            // px of travel that turns a hold into an orbit
const DOUBLE_MS   = 340;
const CHUCK_UP    = 30;           // double-tap launch speed; apex ~4-7u, not ~1
const DEMO_GAP    = 0.08;         // seconds between bricks when CLEAR goes off
const FLIGHT_MAX = 8;             // seconds before a stray brick is reclaimed

/* ---------- palette ---------- */
/* Real LEGO colours with their BrickLink names and values, because a tray that
   can only offer twelve shades makes for dull suggestions. The third column is
   a family letter: the top-down map Gemini reads has one character per stud, so
   near neighbours collapse to the same mark there while the tray still names
   the exact colour. A picture wants families; a shopping list wants names. */
const LEGO = [
  ['white',               '#f2f3f2', 'w'],
  ['light bluish gray',   '#a0a5a9', 's'],
  ['dark bluish gray',    '#6c6e68', 's'],
  ['light gray',          '#9ba19d', 's'],
  ['dark gray',           '#6d6e5c', 's'],
  ['black',               '#1b2a34', 'k'],
  ['red',                 '#c91a09', 'r'],
  ['dark red',            '#720e0f', 'r'],
  ['coral',               '#ff698f', 'r'],
  ['sand red',            '#d67572', 'r'],
  ['blue',                '#0055bf', 'b'],
  ['dark blue',           '#0a3463', 'b'],
  ['medium blue',         '#5a93db', 'b'],
  ['bright light blue',   '#9fc3e9', 'b'],
  ['sand blue',           '#6074a1', 'b'],
  ['dark azure',          '#078bc9', 'a'],
  ['medium azure',        '#36aebf', 'a'],
  ['dark turquoise',      '#008f9b', 'a'],
  ['green',               '#237841', 'g'],
  ['bright green',        '#4b9f4a', 'g'],
  ['dark green',          '#184632', 'g'],
  ['sand green',          '#a0bcac', 'g'],
  ['lime',                '#bbe90b', 'l'],
  ['olive green',         '#9b9a5a', 'l'],
  ['yellowish green',     '#dfeea5', 'l'],
  ['yellow',              '#f2cd37', 'y'],
  ['bright light yellow', '#fff03a', 'y'],
  ['orange',              '#fe8a18', 'o'],
  ['medium orange',       '#ffa70b', 'o'],
  ['bright light orange', '#f8bb3d', 'o'],
  ['dark orange',         '#a95500', 'o'],
  ['tan',                 '#e4cd9e', 't'],
  ['dark tan',            '#958a73', 't'],
  ['nougat',              '#d09168', 't'],
  ['medium nougat',       '#aa7d55', 't'],
  ['light nougat',        '#f6d7b3', 't'],
  ['reddish brown',       '#582a12', 'n'],
  ['dark brown',          '#352100', 'n'],
  ['purple',              '#81007b', 'p'],
  ['dark purple',         '#3f3691', 'p'],
  ['medium lavender',     '#ac78ba', 'p'],
  ['lavender',            '#e1d5ed', 'p'],
  ['magenta',             '#923978', 'i'],
  ['dark pink',           '#c870a0', 'i'],
  ['bright pink',         '#e4adc8', 'i'],
  ['pink',                '#fc97ac', 'i'],
];
const C = Object.fromEntries(LEGO.map(([n, h]) => [n, h]));
/* ---------- the parts library ----------
   Real elements, with BrickLink part numbers where they are certain. The
   rectangular families (brick, plate, tile) are generated because they are
   systematic in life too; the shaped parts are listed one by one because they
   are not. w = studs along X, d = studs along Z, p = height in plates.
   `run` is how many studs a slope falls across, `flat` how many studs of level
   top a curve keeps. Footprint and height are all the grid ever sees. */
const CATALOG = [];
let nextC = 0;
const add = o => {
  o.c = LEGO[(nextC = (nextC + 5) % LEGO.length)][1];   // a default, usually overridden
  CATALOG.push(o);
  return o;
};

for (const [w, d, part] of [
  [1,1,'3005'],[2,1,'3004'],[3,1,'3622'],[4,1,'3010'],[6,1,'3009'],[8,1,'3008'],
  [2,2,'3003'],[3,2,'3002'],[4,2,'3001'],[6,2,'2456'],[8,2,'3007'],[6,4,'2356'],
]) add({ id:`b${w}x${d}`, w, d, p:3, part, family:'brick', label:`${d}x${w} brick` });

for (const [w, d, p, part] of [                       // taller than one brick
  [2,1,6,'3245'],[1,1,9,'22886'],[1,1,15,'2453'],[2,1,15,'2454'],[2,1,5,'22885'],
]) add({ id:`t${w}x${d}x${p}`, w, d, p, part, family:'brick', label:`${d}x${w} tall brick` });

// Real elements whose surface detail is not modelled — the shape and footprint
// are right, the masonry pattern and side studs are not there.
for (const [w, d, part, name] of [
  [2,1,'98283','masonry brick 1x2'], [4,1,'30414','brick 1x4 side studs'],
]) add({ id:`x${part}`, w, d, p:3, part, family:'brick', label:name });

for (const [w, d, part, name] of [
  [2,1,'2412','grille tile 1x2'],
]) add({ id:`x${part}`, w, d, p:1, part, tile:true, family:'tile', label:name });

for (const [w, d, part] of [
  [1,1,'3024'],[2,1,'3023'],[3,1,'3623'],[4,1,'3710'],[6,1,'3666'],[8,1,'3460'],
  [2,2,'3022'],[3,2,'3021'],[4,2,'3020'],[6,2,'3795'],[8,2,'3034'],
  [3,3,'11212'],[4,4,'3031'],[6,4,'3032'],[8,4,'3035'],
]) add({ id:`p${w}x${d}`, w, d, p:1, part, family:'plate', label:`${d}x${w} plate` });

// tiles have no studs at all, which the grid has to know about
for (const [w, d, part] of [
  [1,1,'3070'],[2,1,'3069'],[3,1,'63864'],[4,1,'2431'],[6,1,'6636'],[8,1,'4162'],
  [2,2,'3068'],[3,2,'26603'],[4,2,'87079'],[6,2,'69729'],[4,4,'1751'],
]) add({ id:`f${w}x${d}`, w, d, p:1, part, tile:true, family:'tile', label:`${d}x${w} tile` });

for (const o of [
  { id:'s3040',  w:2, d:1, p:3, run:1, part:'3040',  label:'slope 45 2x1' },
  { id:'s3039',  w:2, d:2, p:3, run:1, part:'3039',  label:'slope 45 2x2' },
  { id:'s3038',  w:3, d:2, p:3, run:1, part:'3038',  label:'slope 45 2x3' },
  { id:'s3037',  w:4, d:2, p:3, run:1, part:'3037',  label:'slope 45 2x4' },
  { id:'s4286',  w:3, d:1, p:3, run:2, part:'4286',  label:'slope 33 3x1' },
  { id:'s3298',  w:3, d:2, p:3, run:2, part:'3298',  label:'slope 33 3x2' },
  { id:'s4161',  w:3, d:3, p:3, run:2, part:'4161',  label:'slope 33 3x3' },
  { id:'s3299',  w:4, d:3, p:3, run:2, part:'3299',  label:'slope 33 3x4' },
  { id:'s54200', w:1, d:1, p:2, run:1, part:'54200', label:'cheese slope' },
  { id:'s85984', w:2, d:1, p:2, run:1, part:'85984', label:'slope 30 1x2' },
  { id:'s50746', w:2, d:1, p:2, run:1, part:'50746', label:'slope 31 1x2' },
  { id:'s61409', w:2, d:1, p:2, run:1, part:'61409', label:'slope 18 1x2 grille' },
  { id:'s60481', w:2, d:1, p:6, run:1, part:'60481', label:'slope 65 2x1x2' },
  { id:'s4460',  w:2, d:1, p:9, run:1, part:'4460',  label:'slope 75 2x1x3' },
]) add({ ...o, shape:'slope', family:'slope' });

for (const o of [
  { id:'i3665', w:2, d:1, p:3, run:1, part:'3665', label:'inverted 45 2x1' },
  { id:'i3660', w:2, d:2, p:3, run:1, part:'3660', label:'inverted 45 2x2' },
  { id:'i4871', w:4, d:2, p:3, run:1, part:'4871', label:'inverted 45 2x4' },
  { id:'i4287', w:3, d:1, p:3, run:2, part:'4287', label:'inverted 33 3x1' },
  { id:'i3747', w:3, d:2, p:3, run:2, part:'3747', label:'inverted 33 3x2' },
]) add({ ...o, shape:'invslope', family:'slope' });

for (const o of [
  { id:'c11477', w:2, d:1, p:3, flat:1, part:'11477', label:'curve 2x1' },
  { id:'c50950', w:3, d:1, p:3, flat:1, part:'50950', label:'curve 3x1' },
  { id:'c61678', w:4, d:1, p:3, flat:1, part:'61678', label:'curve 4x1' },
  { id:'c15068', w:2, d:2, p:3, flat:1, part:'15068', label:'curve 2x2' },
  { id:'c93606', w:4, d:2, p:3, flat:1, part:'93606', label:'curve 4x2' },
  { id:'c6091',  w:2, d:1, p:4, flat:0, part:'6091',  label:'curved top 2x1' },
  { id:'c24309', w:2, d:1, p:3, flat:0, part:'24309', label:'curve 2x1 inverted' },
  { id:'c33243', w:3, d:1, p:3, flat:0, part:'33243', label:'curve 3x1 inverted' },
]) add({ ...o, shape:'curve', family:'curve' });

// arches: solid top, legs at each end, open beneath
for (const o of [
  { id:'a4490', w:3, d:1, p:3, part:'4490', label:'arch 1x3' },
  { id:'a3659', w:4, d:1, p:3, part:'3659', label:'arch 1x4' },
  { id:'a3455', w:6, d:1, p:3, part:'3455', label:'arch 1x6' },
]) add({ ...o, shape:'arch', family:'arch' });

/* Curved in plan rather than in profile — what you see looking down is the
   curve. Footprint stays the rectangle it sits in, as with every other shape;
   only the studs know about the missing corner. */
for (const o of [
  { id:'q3063',  w:2, d:2, p:3, part:'3063',  label:'round corner 2x2' },
  { id:'q27925', w:2, d:2, p:1, part:'27925', tile:true, label:'round corner tile 2x2' },
  { id:'q25269', w:1, d:1, p:1, part:'25269', tile:true, label:'quarter round tile' },
  { id:'q85080', w:1, d:1, p:1, part:'85080', label:'quarter round plate' },
]) add({ ...o, shape:'quarter', family:'curve' });

for (const o of [
  { id:'w26601', w:2, d:2, p:1, part:'26601', label:'cut corner plate 2x2' },
  { id:'w51739', w:4, d:2, p:1, part:'51739', label:'wedge plate 2x4' },
  { id:'w43722', w:3, d:2, p:1, part:'43722', label:'wedge plate 2x3' },
  { id:'w43723', w:3, d:2, p:1, part:'43723', label:'wedge plate 2x3 left' },
  { id:'w41769', w:4, d:2, p:1, part:'41769', label:'wedge plate 2x4 right' },
  { id:'w41770', w:4, d:2, p:1, part:'41770', label:'wedge plate 2x4 left' },
]) add({ ...o, shape:'wedge', family:'curve', cut:o.id === 'w26601' });

for (const o of [
  { id:'k4589', w:1, d:1, p:2, part:'4589', label:'cone 1x1' },
  { id:'k3942', w:2, d:2, p:6, part:'3942', label:'cone 2x2x2' },
]) add({ ...o, shape:'cone', family:'round' });

// domes are smooth on top: nothing sits on one
for (const o of [
  { id:'d553',   w:2, d:2, p:3, part:'553',   label:'dome 2x2' },
  { id:'d30367', w:2, d:2, p:5, part:'30367', label:'dome 2x2 tall' },
]) add({ ...o, shape:'dome', family:'round', tile:true });

for (const o of [
  { id:'r3062',  w:1, d:1, p:3, part:'3062',  label:'round brick 1x1' },
  { id:'r3941',  w:2, d:2, p:3, part:'3941',  label:'round brick 2x2' },
  { id:'r6141',  w:1, d:1, p:1, part:'6141',  label:'round plate 1x1' },
  { id:'r4032',  w:2, d:2, p:1, part:'4032',  label:'round plate 2x2' },
  { id:'r4073',  w:1, d:1, p:1, part:'4073',  label:'round plate 1x1 open' },
  { id:'r6143',  w:2, d:2, p:3, part:'6143',  label:'round brick 2x2 open' },
  { id:'r87081', w:4, d:4, p:3, part:'87081', label:'round brick 4x4' },
  { id:'r60474', w:4, d:4, p:1, part:'60474', label:'round plate 4x4' },
  { id:'r98138', w:1, d:1, p:1, part:'98138', tile:true, label:'round tile 1x1' },
  { id:'r4150',  w:2, d:2, p:1, part:'4150',  tile:true, label:'round tile 2x2' },
  { id:'r67095', w:3, d:3, p:1, part:'67095', tile:true, label:'round tile 3x3' },
  { id:'r6177',  w:4, d:4, p:1, part:'6177',  tile:true, label:'round tile 4x4' },
]) add({ ...o, shape:'round', family:'round' });

const label = b => b.label;

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
const aim = new THREE.Vector3();          // TARGET plus however far it has been slid

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

/* Gemini arriving. A rising major triad, soft and quick — it should read as
   someone cheerful turning up, not as a notification. */
function chime() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.001;
  [659.25, 830.61, 1046.5].forEach((f, i) => {      // E5, G#5, C6
    const at = t + i * 0.085;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.20, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
    o.connect(g).connect(master);
    play(o, [o, g], at, at + 0.46);
  });
}
/* ...and the idea landing: a scatter of tiny high pings, no two alike. */
function sparkle() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.001;
  for (let i = 0; i < 6; i++) {
    const at = t + i * 0.055 + Math.random() * 0.025;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1800 + Math.random() * 2200, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.09, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    o.connect(g).connect(master);
    play(o, [o, g], at, at + 0.18);
  }
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

/* A shaped body is a 2D side profile extruded across the piece's depth: the
   profile is drawn in x (length) and y (height), so a slope is four points and
   a curve is three plus an arc. Built once per part and shared. */
const geoCache = new Map();
function shapeGeo(def) {
  const h = def.p * PLATE, w = def.w - GAP, d = def.d - GAP;
  if (def.shape === 'round') {
    const g = new THREE.CylinderGeometry(w / 2, w / 2, h, 24);
    g.translate(0, h / 2, 0);
    return g;
  }
  // A plan shape is drawn looking down and extruded upward, so the profile
  // branches below never see it. After rotateX(-90) the extrusion axis is up
  // and the plan's own y has landed on world -z, hence the +d/2 shift back.
  if (def.shape === 'quarter' || def.shape === 'wedge') {
    const sh = new THREE.Shape();
    if (def.shape === 'quarter') {
      sh.moveTo(0, 0); sh.lineTo(w, 0);
      sh.absarc(0, 0, w, 0, Math.PI / 2, false);
      sh.lineTo(0, 0);
    } else if (def.cut) {                       // square with one corner taken off
      sh.moveTo(0, 0); sh.lineTo(w, 0); sh.lineTo(w, d - 1);
      sh.lineTo(w - 1, d); sh.lineTo(0, d); sh.lineTo(0, 0);
    } else {                                    // tapers away to half its depth
      sh.moveTo(0, 0); sh.lineTo(w, 0); sh.lineTo(w, d); sh.lineTo(0, d / 2); sh.lineTo(0, 0);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 18 });
    g.rotateX(-Math.PI / 2);
    g.translate(-w / 2, 0, d / 2);
    return g;
  }
  if (def.shape === 'cone') {
    const g = new THREE.CylinderGeometry(w * 0.31, w / 2, h, 20);
    g.translate(0, h / 2, 0);
    return g;
  }
  if (def.shape === 'dome') {                   // upper hemisphere, squashed to height
    const g = new THREE.SphereGeometry(w / 2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, h / (w / 2), 1);
    return g;
  }
  const s = new THREE.Shape();
  if (def.shape === 'arch') {                   // solid top, a leg at each end
    const leg = 1;
    s.moveTo(0, 0); s.lineTo(0, h); s.lineTo(w, h); s.lineTo(w, 0);
    s.lineTo(w - leg, 0);
    s.quadraticCurveTo(w / 2, h * 0.92, leg, 0);
    s.lineTo(0, 0);
  } else if (def.shape === 'slope') {                  // high at +x, falling to nothing
    s.moveTo(0, 0); s.lineTo(w, 0); s.lineTo(w, h);
    s.lineTo(w - def.run, h); s.lineTo(0, 0);
  } else if (def.shape === 'invslope') {        // the same wedge, turned over
    s.moveTo(0, h); s.lineTo(w, h); s.lineTo(w, 0);
    s.lineTo(w - def.run, 0); s.lineTo(0, h);
  } else {                                      // curve: flat top, then it rolls off
    const flat = def.flat ?? 1;
    s.moveTo(0, 0); s.lineTo(w, 0); s.lineTo(w, h); s.lineTo(w - flat, h);
    s.quadraticCurveTo((w - flat) * 0.52, h, 0, 0);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 14 });
  g.translate(-w / 2, 0, -d / 2);               // centre the footprint, base at y=0
  return g;
}
const geoFor = def => {
  if (!geoCache.has(def.id)) geoCache.set(def.id, shapeGeo(def));
  return geoCache.get(def.id);
};
/* Studs only where there is full-height top to put them on — which is also
   exactly where another piece may later rest. A tile has none anywhere. */
function studAt(def, i, j) {
  if (def.tile) return false;
  if (def.shape === 'slope') return def.w > def.run && i >= def.w - def.run;
  if (def.shape === 'curve') return def.w > (def.flat ?? 1) && i >= def.w - (def.flat ?? 1);
  // plan shapes: only where there is actually material under the stud
  if (def.shape === 'quarter') return Math.hypot(i + 0.5, j + 0.5) <= def.w - 0.15;
  if (def.shape === 'wedge')
    return def.cut ? (i + 0.5) + (j + 0.5) < def.w + def.d - 1
                   : (j + 0.5) <= def.d * (0.5 + 0.5 * (i + 0.5) / def.w);
  return true;   // plain, inverted, arch, cone and round: studs the whole way across
}

/* The lump as one object: each part where it sits relative to the lump's centre,
   so turning the group turns the lot. */
function buildAssembly(asm, ghost) {
  const g = new THREE.Group();
  for (const p of asm.parts) {
    const b = buildBrick(p.def, ghost);
    b.rotation.y = p.rot * (Math.PI / 2);
    b.position.set(p.di + p.fw / 2 - asm.W / 2, p.dh * PLATE, p.dj + p.fd / 2 - asm.D / 2);
    g.add(b);
  }
  return g;
}

/* builds a brick as a Group: body + studs. Origin = footprint centre, y = base. */
function buildBrick(def, ghost = false, tintHex = null) {
  const g = new THREE.Group();
  const h = def.p * PLATE;
  const mat = brickMat(tintHex || def.c, ghost);

  let body;
  if (def.shape) {
    body = new THREE.Mesh(geoFor(def), mat);    // profile already sits on y = 0
  } else {
    body = new THREE.Mesh(boxGeo, mat);
    body.scale.set(def.w - GAP, h, def.d - GAP);
    body.position.y = h / 2;
  }
  body.castShadow = !ghost; body.receiveShadow = !ghost;
  body.userData.tint = tintHex || def.c;      // a ghost lump must know its own colours
  g.add(body);

  for (let i = 0; i < def.w; i++) {
    for (let j = 0; j < def.d; j++) {
      if (!studAt(def, i, j)) continue;
      const s = new THREE.Mesh(studGeo, mat);
      s.position.set(i - (def.w - 1) / 2, h + STUD_H / 2, j - (def.d - 1) / 2);
      s.castShadow = !ghost;
      s.userData.tint = tintHex || def.c;
      s.raycast = () => {};                 // studs never block picking
      g.add(s);
    }
  }
  g.userData.pickBody = body;
  // The footprint box, for anything that needs the piece's extent rather than
  // its silhouette — the press highlight, mostly.
  g.userData.span = new THREE.Vector3(def.w - GAP, h, def.d - GAP);
  return g;
}

/* ---------- baseplate ---------- */
/* `build` holds the plate and everything placed on it, so the bounce moves the
   board and its bricks together. Y only — grid maths stays in world X/Z.     */
/* The bench is the room's, not the board's: it never moves, and the board is
   pushed about on top of it. Anything that has been knocked off the build and
   come to rest belongs to the bench too — a brick on the table stays where it
   was left when the board is spun. */
const desk = new THREE.Group();
scene.add(desk);
{
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(DESK_R, DESK_R, 0.05, 96),
    new THREE.MeshPhongMaterial({ color:'#c8d2e2', shininess:6 })
  );
  top.position.y = -PLATE - 0.03;    // so its face lands exactly on TABLE_Y
  top.receiveShadow = true;          // so the board casts onto it and reads as sitting there
  desk.add(top);
}

const build = new THREE.Group();
scene.add(build);
const plateGroup = new THREE.Group();
build.add(plateGroup);
{
  const base = new THREE.Mesh(boxGeo, new THREE.MeshPhongMaterial({ color:'#4e9f63', shininess:24 }));
  base.scale.set(GRID, PLATE, GRID);
  base.position.y = -PLATE / 2;
  base.receiveShadow = true;
  base.castShadow = true;            // there is a bench under it now to catch it
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

/* Height alone cannot describe a slope: the angled half of one stands as tall as
   the rest but has no studs on it, so nothing may sit there. `matable` is that
   second fact, per column — 1 where the top of the stack can take a piece. */
const matable = new Uint8Array(GRID * GRID).fill(1);
const H = (i, j) => heights[j * GRID + i];
const setH = (i, j, v) => { heights[j * GRID + i] = v; };
const canMate = (i, j) => matable[j * GRID + i] === 1;

/* One quarter turn of a cell grid, applied as many times as needed. Doing it by
   repetition rather than by four hand-written formulae means the piece and the
   lump can never disagree about which way round a turn goes. */
function cellTurn(li, lj, W, D, R) {
  let i = li, j = lj, w = W, d = D;
  for (let n = 0; n < (R & 3); n++) { const ni = j; j = w - 1 - i; i = ni; const t = w; w = d; d = t; }
  return [i, j];
}
/* Write a piece into both maps. Rotation is a real quarter turn of the piece,
   not a swap of its width and depth — for a wedge those are different solids. */
function stamp(def, sol, rot, top) {
  for (let li = 0; li < def.w; li++)
    for (let lj = 0; lj < def.d; lj++) {
      const [oi, oj] = cellTurn(li, lj, def.w, def.d, rot);
      const wi = sol.i0 + oi, wj = sol.j0 + oj;
      setH(wi, wj, top);
      matable[wj * GRID + wi] = studAt(def, li, lj) ? 1 : 0;
    }
}
const drop1 = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); };

/* Replayed in placement order, because each brick's `sol.h` was resolved against
   the state at the time it landed. Safe to rebuild after a removal only because
   nothing can be removed while something rests on it — see `isFree`.          */
function rebuildHeights() {
  heights.fill(0);
  matable.fill(1);                       // bare baseplate is studded everywhere
  for (const p of placed) stamp(p.def, p.sol, p.rot, p.sol.h + p.def.p);
}
/* Nothing on top: every column under the footprint tops out at this brick. */
function isFree(rec) {
  if (rec.kind === 'loose') return true;
  const s = rec.sol, top = s.h + rec.def.p;
  for (let i = s.i0; i < s.i0 + s.w; i++)
    for (let j = s.j0; j < s.j0 + s.d; j++) if (H(i, j) !== top) return false;
  return true;
}
/* Everything resting on this piece, and everything resting on those. A real
   brick comes up as a lump and takes its passengers with it; so should this. */
const foots = (p, q) => p.i0 < q.i0 + q.w && q.i0 < p.i0 + p.w &&
                        p.j0 < q.j0 + q.d && q.j0 < p.j0 + p.d;
function assemblyOf(root) {
  const members = [root], seen = new Set([root]);
  for (let n = 0; n < members.length; n++) {
    const a = members[n], top = a.sol.h + a.def.p;
    for (const b of placed)
      if (!seen.has(b) && b.sol.h === top && foots(a.sol, b.sol)) { seen.add(b); members.push(b); }
  }
  return members;
}
/* Re-expressed relative to the lump's own low corner, so it can be carried
   around and turned without caring where it came from. */
function toLocal(members) {
  let i0 = GRID, j0 = GRID, h0 = Infinity;
  for (const m of members) {
    i0 = Math.min(i0, m.sol.i0); j0 = Math.min(j0, m.sol.j0); h0 = Math.min(h0, m.sol.h);
  }
  let W = 0, D = 0, H = 0;
  const parts = members.map(m => {
    const q = { def:m.def, rot:m.rot, di:m.sol.i0 - i0, dj:m.sol.j0 - j0, dh:m.sol.h - h0,
                fw:m.sol.w, fd:m.sol.d };
    W = Math.max(W, q.di + q.fw); D = Math.max(D, q.dj + q.fd); H = Math.max(H, q.dh + m.def.p);
    return q;
  });
  return { parts, W, D, H };
}
/* A quarter turn of the whole lump about its own centre. Each part turns with
   it and lands at a different corner — the same mapping a single piece uses. */
const turnOnce = a => ({ W: a.D, D: a.W, H: a.H,
  parts: a.parts.map(p => ({ def:p.def, rot:(p.rot + 1) & 3, dh:p.dh,
    di:p.dj, dj:a.W - p.di - p.fw, fw:p.fd, fd:p.fw })) });
function turnAsm(asm, R) {
  let a = asm;
  for (let n = 0; n < (R & 3); n++) a = turnOnce(a);
  return a;
}

/* Where does a whole lump come to rest, and may it? Three things have to hold,
   and the second is the one a single brick never had to worry about:
   it drops until something stops it; no part may end up inside anything already
   standing — including a part high in the lump meeting a tower beside it; and
   something on its underside must land on studs.                            */
function solveAsm(px, pz, asm, R) {
  const t = turnAsm(asm, R);
  const I0 = clamp(Math.round(px + GRID / 2 - t.W / 2), 0, GRID - t.W);
  const J0 = clamp(Math.round(pz + GRID / 2 - t.D / 2), 0, GRID - t.D);

  let h = 0;                                   // lower it until a part touches down
  for (const p of t.parts)
    for (let i = 0; i < p.fw; i++)
      for (let j = 0; j < p.fd; j++)
        h = Math.max(h, H(I0 + p.di + i, J0 + p.dj + j) - p.dh);

  let ok = true, grip = false;
  for (const p of t.parts) {
    if (h + p.dh + p.def.p > MAX_STACK) { ok = false; break; }
    for (let i = 0; i < p.fw && ok; i++)
      for (let j = 0; j < p.fd; j++) {
        const wi = I0 + p.di + i, wj = J0 + p.dj + j, floor = H(wi, wj);
        if (h + p.dh < floor) { ok = false; break; }        // this part is inside something
        if (h + p.dh === floor && canMate(wi, wj)) grip = true;
      }
  }
  return { I0, J0, W:t.W, D:t.D, h, parts:t.parts, ok: ok && grip };
}

/* Out of whichever world it was in, and out of every list that referenced it. */
function detach(rec, defer) {
  if (rec.kind === 'placed') { drop1(placed, rec); if (!defer) rebuildHeights(); }
  else                       { drop1(loose, rec); }
  drop1(hitList, rec.g.userData.pickBody);
  drop1(pickList, rec.g.userData.pickBody);
  rec.g.parent?.remove(rec.g);
}

/* =========================== bench and board =========================== */
/* Two frames of reference meet here, and keeping them apart is what makes the
   thing feel like an object rather than a picture of one.
     - The camera is a person sitting at a bench. It never walks around and it
       never slides sideways. It leans in and out, and it tilts. That is all.
     - Everything else is the board, which spins and slides under the hands.
   Every "which way is it facing me" question in the rest of the file still asks
   `view.az`, which is now derived rather than driven: the camera sits at a
   fixed heading and the board turns, so the angle between them is one minus
   the other. Nothing downstream can tell the difference. */
/* `bpol`/`brad` are where the hands parked the view; `tpol`/`trad` are where it
   is actually being asked to go, once the head has leaned away from there. Two
   layers rather than one, so a pinch still chooses the zoom and leaning in
   still nudges it, instead of the two overwriting each other. */
const view  = { pol: 0.92, rad: 34, tpol: 0.92, trad: 34, bpol: 0.92, brad: 34, az: -0.7 };
const board = { yaw: 0, x: 0, z: 0, tyaw: 0, tx: 0, tz: 0 };
const HOME  = { az: -0.7, pol: 0.92, rad: 34 };
const POL_MIN = 0.30, POL_MAX = 1.40;            // ~17° (top-down-ish) .. ~80° (near horizon)
const RAD_MIN = 12,  RAD_MAX = 56;
const EASE = 0.22;                               // how hard the view chases its target
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

/* The lamp is bolted to the bench: fixed height, fixed heading, and the board
   turns underneath it, so the shadows sweep round for real instead of being
   faked by dragging the lights along with the camera. Only the patch of bench
   the shadow map covers travels with the board — a 1024 map spread over the
   whole room would be a waste of most of it. */
const SUN_OFF = new THREE.Vector3(9, 16, 7);
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);
sun.target = sunTarget;

function applyBoard() {
  build.rotation.y = board.yaw;
  build.position.x = board.x;
  build.position.z = board.z;
  view.az = HOME.az - board.yaw;      // how the board is turned, from where you sit
  sunTarget.position.set(board.x, 0, board.z);
  sunTarget.updateMatrixWorld();
  sun.position.copy(sunTarget.position).add(SUN_OFF);
  // A raycast can follow in the same event, before the renderer has run.
  build.updateMatrixWorld(true);
}

/* The board is a solid thing being pushed across a table with other solid
   things on it. Shoving it into them and having them sit inside it would give
   the whole illusion away, so the leading edge knocks them clear — at whatever
   speed that edge is actually travelling, which for a spun board is faster at
   the corners than in the middle. */
const swept = { x:0, z:0, yaw:0 };
const cvel = new THREE.Vector3();
function sweep(dt) {
  const dx = board.x - swept.x, dz = board.z - swept.z, dyaw = wrapPi(board.yaw - swept.yaw);
  swept.x = board.x; swept.z = board.z; swept.yaw = board.yaw;
  if (!loose.length || dt <= 0) return;
  if (Math.abs(dx) + Math.abs(dz) + Math.abs(dyaw) * 8 < 1e-3) return;   // sitting still
  const half = GRID / 2 + 0.4;                    // the plate, plus a brick's shoulder
  const w = -dyaw / dt;                           // +Y turn carries a point the other way
  for (let i = loose.length - 1; i >= 0; i--) {
    const rec = loose[i];
    const p = rec.g.position;                     // the bench is the room: no transform
    const q = build.worldToLocal(tmpQ.copy(p));
    if (Math.abs(q.x) > half || Math.abs(q.z) > half) continue;
    // out by whichever edge it is nearest, in the board's own axes
    const ox = half - Math.abs(q.x), oz = half - Math.abs(q.z);
    const nx = ox <= oz ? Math.sign(q.x) || 1 : 0, nz = ox <= oz ? 0 : Math.sign(q.z) || 1;
    const out = build.localToWorld(tmpH.set(q.x + nx * (ox + 0.05), 0, q.z + nz * (oz + 0.05)));
    // the speed of the plate at the point of contact: how fast it slid, plus how
    // fast that bit of it was swinging
    const rx = p.x - board.x, rz = p.z - board.z;
    cvel.set(dx / dt - w * rz, 0, dz / dt + w * rx);
    const sp = Math.min(cvel.length(), 26);
    detach(rec);
    desk.add(rec.g);
    rec.g.position.set(out.x, TABLE_Y, out.z);
    cvel.setLength(Math.max(sp * 1.25, 3.5));     // always outruns the edge that hit it
    flying.push({ g: rec.g, def: rec.def, rot: 0, mode:'discard', sticks:false, bounces:0, age:0,
                  vel: new THREE.Vector3(cvel.x, 1.4 + sp * 0.12, cvel.z),
                  spin: new THREE.Vector3(0, (Math.random() * 2 - 1) * (2 + sp * 0.3), 0) });
    clatter();
  }
}

function applyCamera(dt = 0) {
  stepCoast(dt);
  view.tpol = clamp(view.bpol + HEAD.tilt, POL_MIN, POL_MAX);
  view.trad = clamp(view.brad * HEAD.push, RAD_MIN, RAD_MAX);
  view.pol  += (view.tpol  - view.pol)  * EASE;
  view.rad  += (view.trad  - view.rad)  * EASE;
  board.yaw += (board.tyaw - board.yaw) * EASE;
  board.x   += (board.tx   - board.x)   * EASE;
  board.z   += (board.tz   - board.z)   * EASE;
  applyBoard();
  aim.copy(TARGET);
  const s = Math.sin(view.pol);
  // Leaning sideways moves the seat, not the board: `view.az` stays the honest
  // answer to "which way is the board facing me", so nothing downstream — the
  // brick in your hand, the map Gemini reads — twitches as you shift about.
  const az = HOME.az + HEAD.turn;
  camera.position.set(
    TARGET.x + view.rad * s * Math.sin(az),
    TARGET.y + view.rad * Math.cos(view.pol),
    TARGET.z + view.rad * s * Math.cos(az)
  );
  camera.lookAt(aim);
  camera.updateMatrixWorld();   // keep raycasts in sync with the damped camera
}

/* =========================== pointer routing =========================== */
/* Every pointer is independently owned by either the navigator (stage) or a
   drag session (menu). One hand can hold the board while the other drags a
   brick.                                                                     */
const nav   = new Map();   // pointerId -> {x,y}
const drags = new Map();   // pointerId -> {def, tile, held, ghost, sol, rot, az0}
let grip = null;           // the board, held: see regrab()
let onBoard = false;       // did this gesture start on the plate, or off it?
let manualRot = 0;         // optional 90° offset; the plate's angle does the rest
let flickOn = true;        // throwing; F turns it off, there is no button
let selected = 0;

/* Where a screen point meets the top of the board. Null when the ray is aimed
   at the sky, which is the one place a drag can't be about the board. */
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const gpt = new THREE.Vector3();
function groundAt(x, y) {
  if (!castFrom(x, y)) return null;
  return ray.ray.intersectPlane(GROUND, gpt) ? gpt.clone() : null;
}
/* The bench is not the board. Putting a finger on the table beside a model and
   having the model move is the sort of thing only software does — so the grip
   is the plate's footprint and nothing else. */
function onPlate(p) {
  if (!p) return false;
  const q = build.worldToLocal(p.clone());
  return Math.abs(q.x) <= GRID / 2 && Math.abs(q.z) <= GRID / 2;
}

/* Take hold of the board — or take hold of it again, because a hand that gains
   or loses a finger is a different grip and has to be re-seated. What is
   remembered is a point *of the board*, so that whatever happens next, that
   point can be put back under the hand.
   This is also the only place that decides whether the gesture is about the
   board at all. Re-deciding on a change of grip is fine — that is already a new
   hold — but never mid-drag: a finger that starts on the board and wanders off
   into the sky is still holding the board. */
function regrab() {
  const pts = [...nav.values()];
  const gs = pts.map(p => groundAt(p.x, p.y));
  if (!gs.length || gs.length > 2 || gs.some(g => !g)) { grip = null; onBoard = false; return; }
  const m = gs.length === 2 ? gs[0].clone().add(gs[1]).multiplyScalar(0.5) : gs[0].clone();
  onBoard = onPlate(m);
  if (!onBoard) { grip = null; return; }
  coast = null;                            // a hand on it stops it dead
  grip = {
    n: gs.length,
    t: 0, vx: 0, vz: 0, vyaw: 0,           // how fast it is being pushed, for the let-go
    lx: board.x, lz: board.z, lyaw: board.yaw,
    q: build.worldToLocal(m.clone()),      // the bit of board under the hand
    at: m.clone(),                          // ...and where it was last seen
    twist: gs.length === 2 ? Math.atan2(gs[1].z - gs[0].z, gs[1].x - gs[0].x) : 0,
    dist: gs.length === 2 ? Math.max(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), 1) : 1,
    rad: view.brad,
  };
}

/* ---------- navigation (stage) ---------- */
stageEl.addEventListener('pointerdown', e => {
  unlock();
  try { stageEl.setPointerCapture(e.pointerId); } catch {}
  if (castFrom(e.clientX, e.clientY)) {           // did it land on a brick?
    const hit = ray.intersectObjects(pickList, false)[0];
    if (hit && hit.object.userData.owner) startHold(e, hit.object.userData.owner, hit.point);
  }
  nav.set(e.pointerId, { x:e.clientX, y:e.clientY });
  regrab();
});

function moveNav(e) {
  const p = nav.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;

  /* Off the plate there is nothing to hold, so the drag moves the head rather
     than the board — the only way to tilt when the camera isn't watching you.
     Deliberately tilt *only*: a hand on the bench is not touching the model,
     and having the model answer to it is what felt wrong. */
  if (!onBoard) {
    if (nav.size === 1) view.bpol = clamp(view.bpol - dy * 0.006, POL_MIN, POL_MAX);
    return;
  }
  if (!grip) return;
  const pts = [...nav.values()];
  if (pts.length !== grip.n) return;
  const gs = pts.map(q => groundAt(q.x, q.y));
  if (gs.some(g => !g)) return;

  let m, turn = 0;
  if (grip.n === 2) {
    /* Two hands on it and there is nothing left to guess: a pair of contacts
       fixes an angle outright, so the board turns exactly as far as they do.
       This is the easy way round, and it is why one finger is the hard way. */
    m = gs[0].clone().add(gs[1]).multiplyScalar(0.5);
    const t = Math.atan2(gs[1].z - gs[0].z, gs[1].x - gs[0].x);
    turn = wrapPi(t - grip.twist);
    grip.twist = t;
    // Pinch reads in pixels, not in world units: measuring the spread on the
    // board it is currently scaling would chase its own tail.
    const d = Math.max(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), 1);
    view.brad = clamp(grip.rad * (grip.dist / d), RAD_MIN, RAD_MAX);
    view.rad  = clamp(view.brad * HEAD.push, RAD_MIN, RAD_MAX);
  } else {
    /* One finger is a shove, not a grip, so how much of it becomes spin is
       settled the way a real bench settles it: by where you pushed. r² over
       r² plus the plate's radius of gyration squared is the share of a shove
       that a free body puts into turning — none at all through the middle,
       most of it out at the rim. Which is exactly the asked-for feel: hard to
       turn with one finger, and never impossible. */
    m = gs[0];
    const cx = m.x - board.x,       cz = m.z - board.z;
    const px = grip.at.x - board.x, pz = grip.at.z - board.z;
    const r2 = cx * cx + cz * cz;
    turn = wrapPi(Math.atan2(cz, cx) - Math.atan2(pz, px)) * (r2 / (r2 + RHO2));
  }
  grip.at.copy(m);
  // Turning about +Y carries a point the other way round in atan2(z, x), so the
  // yaw runs opposite to the angle the hand swept.
  board.yaw = board.tyaw = board.yaw - turn;

  /* The turn chose a heading; this pins the board down. Whatever it did, the
     bit of board that was picked up goes back under the hand — which is the
     whole feel being chased, and the reason none of this is expressed as a
     camera nudge per pixel of travel. */
  const c = Math.cos(board.yaw), s = Math.sin(board.yaw);
  let bx = m.x - (grip.q.x * c + grip.q.z * s);
  let bz = m.z - (grip.q.z * c - grip.q.x * s);
  const d = Math.hypot(bx, bz);
  if (d > SLIDE_MAX) { bx *= SLIDE_MAX / d; bz *= SLIDE_MAX / d; }   // and never off the bench
  board.x = board.tx = bx;
  board.z = board.tz = bz;

  // How fast it is being pushed, kept off the board's own motion rather than
  // off the screen, so a let-go already accounts for the camera. Smoothed, and
  // a hand that stops moving decays to nothing within a few frames — so a still
  // release sets it down rather than throwing it.
  const t = performance.now();
  if (grip.t) {
    const dt = (t - grip.t) / 1000;
    if (dt > 0.001) {
      grip.vx   = grip.vx   * 0.5 + ((board.x - grip.lx) / dt) * 0.5;
      grip.vz   = grip.vz   * 0.5 + ((board.z - grip.lz) / dt) * 0.5;
      grip.vyaw = grip.vyaw * 0.5 + (wrapPi(board.yaw - grip.lyaw) / dt) * 0.5;
    }
  }
  grip.t = t; grip.lx = board.x; grip.lz = board.z; grip.lyaw = board.yaw;
  applyBoard();          // the next groundAt in this same gesture must see it
}

/* Let go of a shove and it runs on for a moment. A baseplate on a bench is not
   nailed down — but it is a wide flat thing on a wide flat thing, so this is a
   short slide, not a hockey puck. */
const SLIDE_DRAG = 0.90;        // per 60th of a second
const COAST_MAX  = 26;          // units/s, so a wild flick can't launch it
const SPIN_MAX   = 3.4;         // rad/s
let coast = null;
function letGo(g) {
  const sp = Math.hypot(g.vx, g.vz);
  if (sp < 1.2 && Math.abs(g.vyaw) < 0.5) return;      // set down, not thrown
  const k = sp > COAST_MAX ? COAST_MAX / sp : 1;
  coast = { vx: g.vx * k, vz: g.vz * k, vyaw: clamp(g.vyaw, -SPIN_MAX, SPIN_MAX) };
}
function stepCoast(dt) {
  if (!coast) return;
  board.tyaw = board.yaw = board.yaw + coast.vyaw * dt;
  let bx = board.x + coast.vx * dt, bz = board.z + coast.vz * dt;
  const d = Math.hypot(bx, bz);
  if (d > SLIDE_MAX) {                                  // into the rim, and stopped
    bx *= SLIDE_MAX / d; bz *= SLIDE_MAX / d;
    coast.vx = coast.vz = 0;
  }
  board.tx = board.x = bx;
  board.tz = board.z = bz;
  const k = Math.pow(SLIDE_DRAG, dt * 60);
  coast.vx *= k; coast.vz *= k; coast.vyaw *= k;
  if (Math.hypot(coast.vx, coast.vz) < 0.05 && Math.abs(coast.vyaw) < 0.02) coast = null;
}

function endNav(e) {
  if (!nav.delete(e.pointerId)) return;
  if (!nav.size && onBoard && grip) letGo(grip);
  regrab();
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
const tmpQ = new THREE.Vector3();   // a room point, borrowed by the board

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
  const w = (rot & 1) ? def.d : def.w;
  const d = (rot & 1) ? def.w : def.d;
  const i0 = clamp(Math.round(px + GRID / 2 - w / 2), 0, GRID - w);
  const j0 = clamp(Math.round(pz + GRID / 2 - d / 2), 0, GRID - d);

  // Rest on the highest column under the footprint. Overhang is allowed — a
  // real brick juts out over air happily as long as some studs grip it — which
  // is what lets you stagger courses and build upwards. Nothing can intersect:
  // every column is at or below `h`, and the brick starts at `h`.
  let h = 0;
  for (let i = i0; i < i0 + w; i++)
    for (let j = j0; j < j0 + d; j++) h = Math.max(h, H(i, j));
  let ok = h + def.p <= MAX_STACK;
  // It comes to rest on the columns that actually reach `h`, and at least one of
  // those has to carry studs. One stud is enough to hold a brick, so a piece may
  // grip the flat half of a slope and overhang the angled half — the same
  // overhang allowed anywhere else. What it may not do is rest on the angled
  // face alone, which is what a slope with nothing flat under the piece means.
  if (ok && h > 0) {
    let grip = false;
    for (let i = i0; i < i0 + w && !grip; i++)
      for (let j = j0; j < j0 + d; j++)
        if (H(i, j) === h && canMate(i, j)) { grip = true; break; }
    ok = grip;
  }
  return { i0, j0, w, d, h, ok };
}
/* A raycast answers in the room's coordinates; the grid only knows the board's.
   Everything on the far side of this function is board-local, which is what
   lets `solveAt` and the whole of `heights` carry on as though the board had
   never moved. The face normal has to be taken into the room first — it comes
   out of the geometry in the brick's own axes, and the brick is turned. */
const tmpN = new THREE.Vector3(), tmpH = new THREE.Vector3();
function boardHit(hit) {
  // nudge into the column we actually hit — side faces sit exactly on a seam
  tmpN.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  return build.worldToLocal(tmpH.copy(hit.point).addScaledVector(tmpN, -0.02));
}
/* ...and where does the brick under `ray` land? null if it misses the build */
function solveRay(def, rot, gx = 0, gz = 0) {
  const hit = ray.intersectObjects(hitList, false)[0];
  if (!hit) return null;
  // back off by the grab, so the piece lands where the finger is holding it
  const p = boardHit(hit);
  return solveAt(p.x - gx, p.z - gz, def, rot);
}
const solve = (x, y, def, rot) => castFrom(x, y) ? solveRay(def, rot) : null;
function solveRayAsm(asm, R, gx = 0, gz = 0) {
  const hit = ray.intersectObjects(hitList, false)[0];
  if (!hit) return null;
  const p = boardHit(hit);
  return solveAsm(p.x - gx, p.z - gz, asm, R);
}
const overBoard = q => Math.abs(q.x) <= GRID / 2 && Math.abs(q.z) <= GRID / 2;

const placeX = (i0, w) => i0 - GRID / 2 + w / 2;

/* =========================== press and hold =========================== */
/* Press a brick and its edges light; keep pressing and it comes loose into your
   hand. A press that travels is an orbit instead, so the two never fight — the
   hold is abandoned the moment the finger moves more than a few pixels.      */
const holds = new Map();        // pointerId -> { rec, line, t0, x0, y0, x, y, blocked }
let lastTap = { rec: null, t: 0 };

function startHold(e, rec, hitPoint) {
  const blocked = false;        // anything can be lifted now, lump and all
  const span = rec.g.userData.span;
  // Depth-tested on purpose: drawing through the brick reads as an x-ray cage
  // rather than its edges lighting up. Nudged out just far enough to clear the
  // surface without z-fighting.
  const line = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
    color: blocked ? '#ff3b3b' : '#ffd21e', transparent: true, opacity: 0.35,
    depthWrite: false,
  }));
  line.scale.copy(span).multiplyScalar(1.03);
  line.position.y = span.y / 2;
  line.renderOrder = 2;
  rec.g.add(line);
  holds.set(e.pointerId, { rec, blocked, line, t0: performance.now(), hit: hitPoint.clone(),
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
    if (t >= 1) liftBrick(pid, h);
  }
}
/* Straight from the build into the hand: same drag session a palette brick gets,
   seeded so it keeps the orientation it was sitting in.                      */
function liftBrick(pid, h) {
  const rec = h.rec;
  cancelHold(pid);
  nav.delete(pid);                                // this is a drag now, not a grip
  grip = null; onBoard = false;
  pluckSound(true);
  if (rec.kind === 'loose') {                     // a desk piece is only ever itself
    const def = rec.def;
    // a loose brick belongs to the bench, so the stored hit is already in its
    // coordinates; a placed one has to be brought onto the board first
    const grab = h.hit && { x: h.hit.x - rec.g.position.x, z: h.hit.z - rec.g.position.z };
    detach(rec);
    beginDrag({ pointerId: pid, clientX: h.x, clientY: h.y }, def, null, undefined, null, grab);
    return;
  }
  // Take the whole lump. A single brick is just a lump of one, so this is the
  // only lifting path off the board and there is no second case to keep in step.
  const members = assemblyOf(rec);
  const asm = toLocal(members);
  // Measure the grab against the lump's centre *before* it comes apart, so the
  // piece stays under the finger where it was taken hold of rather than jumping
  // to be held by its middle.
  let i0 = GRID, j0 = GRID;
  for (const m of members) { i0 = Math.min(i0, m.sol.i0); j0 = Math.min(j0, m.sol.j0); }
  const bh = h.hit && build.worldToLocal(h.hit.clone());
  const grab = bh && { x: bh.x - placeX(i0, asm.W), z: bh.z - placeX(j0, asm.D) };
  for (const m of members) detach(m, true);
  rebuildHeights();
  // The lump comes up in the orientation it was sitting in, so it starts unturned.
  beginDrag({ pointerId: pid, clientX: h.x, clientY: h.y }, rec.def, null, 0, asm, grab);
}
/* A press that neither travelled nor lasted is a tap; two of them chuck it. */
function tapHold(e) {
  const h = holds.get(e.pointerId);
  if (!h) return;
  const rec = h.rec;
  cancelHold(e.pointerId);
  const now = performance.now();
  if (lastTap.rec === rec && now - lastTap.t < DOUBLE_MS) {
    lastTap = { rec: null, t: 0 };
    // Throwing one away is still single-piece: nothing may be sitting on it.
    isFree(rec) ? chuck(rec) : nope();
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
/* Four, not two. Parity is enough for a rectangle, where a half turn looks the
   same as none — but a slope, a wedge or a rounded corner faces a direction,
   and two of its four headings were simply unreachable. */

function beginDrag(e, def, srcEl, seedRot, asm, grab) {
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
              rot0: seedRot === undefined ? screenParity(def) : ((seedRot - manualRot) & 3),
              asm, held:null, ghost:null, rot:-1, sol:null, yaw:0, yawTo:0,
              // where on the piece the finger actually took hold, in the piece's
              // own unrotated frame. Zero for anything pulled from the tray.
              gx: grab ? grab.x : 0, gz: grab ? grab.z : 0,
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

  /* Four headings, not two. `& 1` is the seductive wrong answer here — it is
     right for every rectangle, because a half turn of a 2x4 looks identical to
     no turn at all, and wrong for everything that faces a direction. It is also
     what the hand was never doing: the held piece has always animated through
     all four, so a slope could be lined up by eye and then snap somewhere else
     on release. */
  const turns = gridTurns(s), rot = turns & 3;
  if (!s.held) {                                    // built once, then only turned
    s.held = s.asm ? buildAssembly(s.asm) : buildBrick(s.def);
    scene.add(s.held);
    s.yaw = turns * (Math.PI / 2);
    if (s.asm) { s.ghost = buildAssembly(s.asm, true); build.add(s.ghost); }   // lump ghost
  }
  // The hand twists; it doesn't teleport. The ghost still snaps, because it is
  // answering "where does this land", not "what is my hand doing".
  s.yawTo = turns * (Math.PI / 2);
  s.yaw += (s.yawTo - s.yaw) * 0.32;
  s.held.rotation.y = board.yaw + s.yaw;   // the hand is in the room's axes
  if (!s.ghost) { s.ghost = buildBrick(s.def, true); build.add(s.ghost); }
  s.ghost.rotation.y = rot * (Math.PI / 2);         // built once, only ever turned
  s.rot = rot;

  // The grab point is fixed to the piece, so it swings round as the piece turns.
  // The ghost uses the snapped angle and the held piece the animated one, so the
  // landing spot stays still while the thing in your hand is still turning.
  const snap = rot * (Math.PI / 2);
  const gx = s.gx * Math.cos(snap) + s.gz * Math.sin(snap);
  const gz = -s.gx * Math.sin(snap) + s.gz * Math.cos(snap);
  const sol = over ? (s.asm ? solveRayAsm(s.asm, rot, gx, gz) : solveRay(s.def, rot, gx, gz)) : null;
  s.sol = sol;

  s.held.visible = over;
  if (over) {                                       // hang the brick under the finger
    const hh = (s.asm ? s.asm.H : s.def.p) * PLATE;
    // the landing height is the board's; the hand's is the room's, and the
    // board is a bounce away from level
    const y  = (sol ? sol.h * PLATE : 0) + HOVER + build.position.y;
    hoverPlane.constant = -y;
    if (ray.ray.intersectPlane(hoverPlane, tmpV)) {
      // sit just above the fingertip, so the finger and the brick don't hide
      // the landing ghost directly beneath them on the same screen ray
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const wy = board.yaw + s.yaw;
      const hx = s.gx * Math.cos(wy) + s.gz * Math.sin(wy);
      const hz = -s.gx * Math.sin(wy) + s.gz * Math.cos(wy);
      s.held.position.set(tmpV.x - hx, y - hh / 2, tmpV.z - hz).addScaledVector(camUp, LIFT);
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
  if (s.asm) {   // one verdict for the whole lump: it goes down entire or not at all
    s.ghost.position.set(placeX(sol.I0, sol.W), sol.h * PLATE, placeX(sol.J0, sol.D));
    s.ghost.traverse(o => {
      if (o.isMesh) o.material = brickMat(sol.ok ? o.userData.tint : '#ff3b3b', true);
    });
    return;
  }
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
  const thrown = flickOn && from && !s.asm && s.vel.length() >= FLICK_MIN;
  const vel = s.vel.clone(), { def, sol, rot } = s;
  closeDrag(s, e.pointerId);
  if (s.asm) {                                 // a lump is never thrown, only set down
    if (sol && sol.ok)  placeAsm(s.asm, sol);
    else if (from)      shedAsm(s.asm, rot, from);
  }
  else if (thrown)         launch(def, rot, from, vel);
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
  g.rotation.set(0, rot * (Math.PI / 2), 0);
  build.add(g);
  hitList.push(g.userData.pickBody);
  stamp(def, sol, rot, sol.h + def.p);
  const p = { g, def, sol, rot, base, anim: null, kind: 'placed' };
  g.userData.pickBody.userData.owner = p;
  pickList.push(g.userData.pickBody);
  placed.push(p);
  return p;
}
/* Every shaped piece is modelled facing one way and turned into place. Swapping
   width for depth is only the same thing for a box; for a wedge or a curve it
   builds a different solid entirely. */
const oriented = (def, rot) => {
  const g = buildBrick(def);
  g.rotation.y = rot * (Math.PI / 2);
  return g;
};

function place(def, sol, rot, from) {
  const p = commit(oriented(def, rot), def, sol, rot);
  // fall into the socket from wherever the hand released it — `from` is the
  // room's, `base` the board's, and the board is bounced and turned and slid
  const off = from ? build.worldToLocal(from.clone()).sub(p.base) : new THREE.Vector3(0, 0.9, 0);
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
/* Down it goes, all of it, each part committed at its own place in the lump.
   One click and one knock for the lot — it arrived as one thing. */
function placeAsm(asm, sol) {
  for (const p of sol.parts) {
    const sub = { i0: sol.I0 + p.di, j0: sol.J0 + p.dj, w: p.fw, d: p.fd,
                  h: sol.h + p.dh, ok: true };
    const rec = commit(buildBrick(p.def), p.def, sub, p.rot);
    const off = new THREE.Vector3(0, 1.2, 0);
    rec.anim = { off, t: 0, v: 0.015 };
    rec.g.position.copy(rec.base).add(off);
  }
  const studs = sol.parts.reduce((n, p) => n + p.fw * p.fd, 0);
  boardY.v -= Math.min(0.066 + studs * 0.014, 0.24);
  popSound(sol.h + asm.H);
  navigator.vibrate?.(14);
}
/* Released somewhere it cannot go: it comes apart onto the desk rather than
   vanishing, the same as a single piece dropped off the build. */
function shedAsm(asm, R, from) {
  const t = turnAsm(asm, R);
  const c = Math.cos(board.yaw), sn = Math.sin(board.yaw);
  for (const p of t.parts) {
    const at = from.clone();
    const ox = (p.di - t.W / 2 + 0.5) * 0.9, oz = (p.dj - t.D / 2 + 0.5) * 0.9;
    at.x += ox * c + oz * sn;                  // the lump comes apart along its own
    at.z += oz * c - ox * sn;                  // rows, however the board is turned
    at.y += p.dh * PLATE;
    discard(p.def, p.rot, at, new THREE.Vector3());
  }
}

/* ---------- the flick ---------- */
/* Whether a throw sticks is decided here, at launch, not on arrival — a dud is
   committed to before it ever touches down, so it tumbles the whole way in. */
function launch(def, rot, from, vel) {
  const g = oriented(def, rot);
  g.rotation.y += board.yaw;                    // a brick in the air belongs to the room,
  g.position.copy(from);                        // not to the board it may or may not reach
  desk.add(g);
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
  const out = new THREE.Vector3(p.x - build.position.x, 0, p.z - build.position.z);
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
  const g = oriented(def, rot);
  g.rotation.y += board.yaw;
  g.position.copy(from);
  desk.add(g);
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
  // It may be leaving the board or leaving the bench; either way it leaves in
  // the room's coordinates, from exactly where it was sitting.
  const at = g.getWorldPosition(new THREE.Vector3());
  const face = g.getWorldQuaternion(new THREE.Quaternion());
  detach(rec);
  desk.add(g);
  g.position.copy(at);
  g.quaternion.copy(face);
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
      // Two surfaces, two frames: the board is wherever it has been pushed to,
      // the bench is always where it was.
      const q = build.worldToLocal(tmpQ.copy(p));
      if (overBoard(q)) {
        const sol = solveAt(q.x, q.z, f.def, f.rot);
        if (q.y <= sol.h * PLATE) {
          const top = sol.h * PLATE + build.position.y;
          if (f.sticks && sol.ok) {
            land(commit(f.g, f.def, sol, f.rot));   // clicks in exactly like a drop
            flying.splice(n, 1);
            continue;
          }
          // a discard that came down over the build sheds sideways onto the desk
          f.mode === 'discard' ? botch(f, top, ESCAPE_SOFT, 7)
                               : botch(f, top);
        }
      } else if (p.y <= TABLE_Y && Math.hypot(p.x, p.z) <= TABLE_R) {
        if (f.mode === 'discard') { if (tableBounce(f)) { flying.splice(n, 1); continue; } }
        else skitter(f);
      }
    }
    if (p.y < -25 || f.age > FLIGHT_MAX) {        // gone off the table for good
      f.g.parent?.remove(f.g);
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
const TRAY_SLOTS = 12;
let trayParts = [], trayColours = [], tray = null;

const shuffled = a => { const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]]; }
  return b; };

/* A dozen out of a hundred-odd, but stratified: one guaranteed from each family
   before the rest are filled at random, so a shuffle never comes back as twelve
   plates. */
function pickParts(n) {
  const families = [...new Set(CATALOG.map(d => d.family))];
  const out = [];
  for (const f of shuffled(families)) out.push(shuffled(CATALOG.filter(d => d.family === f))[0]);
  for (const d of shuffled(CATALOG)) {
    if (out.length >= n) break;
    if (!out.includes(d)) out.push(d);
  }
  return shuffled(out).slice(0, n);
}
/* A dozen different colours, not a dozen of the same three. */
const pickColours = n => {
  const pool = shuffled(LEGO.map(([, h]) => h)).slice(0, Math.max(n, 12));
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
};

/* Gemini's palette themes the tray; without one it is simply varied. Either way
   the colours are shuffled across the slots, so the same shade is not always in
   the same corner. Nothing in the catalogue is mutated — a piece dragged out
   carries a copy with the colour of the moment baked in, so anything already on
   the board keeps the colour it was built in. */
function paintTray(palette) {
  tray = palette || null;
  const pool = palette && palette.length ? palette : pickColours(TRAY_SLOTS);
  trayColours = shuffled(Array.from({ length: TRAY_SLOTS }, (_, i) => pool[i % pool.length]));
}
function scramble() {
  trayParts = pickParts(TRAY_SLOTS);
  paintTray(tray);
  renderPalette(true);
}

function renderPalette(flash) {
  paletteEl.replaceChildren();
  trayParts.forEach((def, idx) => {
    const el = document.createElement('div');
    el.className = 'brick' + (idx === 0 ? ' active' : '');
    const sw = document.createElement('div');
    sw.className = 'swatch' + (def.shape ? ' ' + def.shape : '');
    sw.style.background = trayColours[idx] || def.c;
    sw.style.gridTemplateColumns = `repeat(${def.w}, var(--stud))`;
    for (let n = 0; n < def.w * def.d; n++) sw.appendChild(document.createElement('i'));
    const lb = document.createElement('div');
    lb.className = 'lbl';
    lb.textContent = label(def);
    if (def.part) el.title = `part ${def.part}`;
    el.append(sw, lb);
    if (flash) { el.classList.add('recolour'); el.style.animationDelay = idx * 40 + 'ms'; }
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
      // a copy, so the colour it leaves the tray with is the colour it keeps
      beginDrag(e, { ...def, c: trayColours[idx] || def.c }, el);
    });
  });
}

const tap = (id, fn) => document.getElementById(id)
  .addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
scramble();
tap('btnShuffle', scramble);
// colours only: keep the pieces you are looking at, roll new colours onto them
tap('btnColours', () => { paintTray(null); renderPalette(true); });
/* No button for this any more — throwing earned its place. F still toggles it,
   for when a flick needs ruling out while chasing something else.           */
const toggleFlick = () => { flickOn = !flickOn; };
tap('btnUndo', undo);
tap('btnClear', () => {
  demolish();
  chat.length = 0;                       // new build, new conversation
  lastTally = null;
  subject = null; asked = false; rejected = [];
  tray = null; scramble();               // ...and a fresh handful of pieces
});
tap('btnHome', () => {
  view.bpol = HOME.pol; view.brad = HOME.rad;
  // square to the bench and back in the middle of it, keeping the build upright
  board.tyaw = Math.round(board.yaw / (Math.PI * 2)) * Math.PI * 2;
  board.tx = 0; board.tz = 0;
});
tap('btnFull', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
addEventListener('keydown', e => {
  // No button for this any more: spinning the plate turns the brick and is the
  // more discoverable of the two. R stays as a fallback on a fixed view.
  if (e.key === 'r' || e.key === 'R') manualRot = (manualRot + 1) & 3;
  if (e.key === 'z' || e.key === 'Z') undo();
  if (e.key === 'f' || e.key === 'F') toggleFlick();
});

/* =========================== Gemini =========================== */
/* Runs entirely in the browser, so the key lives in localStorage. That is the
   normal shape for a client-only prototype, and it is worth being clear-eyed
   about the trade: anyone with the kiosk or its devtools can read that key, and
   every request carries it from the device. Fine for a prototype on your own
   hardware; for anything public the call belongs behind a server you own. */
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const CFG_KEY = 'brickkiosk.gemini';
const cfg = { key: '', model: '' };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch {}
const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} };

const COLOUR_NAME = Object.fromEntries(LEGO.map(([n, h]) => [h, n]));
const pieceName = d => `${COLOUR_NAME[d.c]} ${d.d}x${d.w} ${d.p === 1 ? 'plate' : 'brick'}`;
/* One character per cell, no separators: a third of the tokens of a spaced
   two-letter grid, and it reads more like the picture it is. Shades collapse
   to their family here — forty marks would be a code, not a picture. */
const CODE = Object.fromEntries(LEGO.map(([n, , f]) => [n, f]));
const FAMILIES = 'r red  o orange  y yellow  l lime  g green  a azure  b blue\n' +
                 'p purple  i pink  n brown  t tan  w white  s grey  k black';

/* The single most useful thing to hand over: what the board actually looks like
   from above. A list of pieces describes the parts; this describes the picture,
   which is what is being asked about. Overhangs resolve to whatever is on top,
   exactly as an eye would see them. */
/* Which way the board is facing from where the person is sitting, in quarter
   turns from the home view. Without this the map is in fixed world axes: spin
   the board a quarter turn and Gemini's "left" stops being your left, so it
   reads the picture rotated and says something that makes no sense from your
   side of the screen. */
const viewTurns = () =>
  (((Math.round((view.az - HOME.az) / (Math.PI / 2)) % 4) + 4) % 4);
/* Output cell -> source cell, for q quarter turns. */
function fromView(x, y, q) {
  const N = GRID - 1;
  return q === 1 ? [y, N - x]
       : q === 2 ? [N - x, N - y]
       : q === 3 ? [N - y, x]
       :           [x, y];
}

function topDown() {
  const colour = new Array(GRID * GRID).fill(null);
  const top = new Int16Array(GRID * GRID);
  for (const p of placed) {
    const s = p.sol, t = s.h + p.def.p;
    for (let i = s.i0; i < s.i0 + s.w; i++)
      for (let j = s.j0; j < s.j0 + s.d; j++) {
        const n = j * GRID + i;
        if (t >= top[n]) { top[n] = t; colour[n] = COLOUR_NAME[p.def.c]; }
      }
  }
  const pad = v => String(v).padStart(2, ' ');
  const head = '    0123456789...   x ->';
  const paint = [head], relief = [head];
  const q = viewTurns();
  let tallest = 0;
  for (let j = 0; j < GRID; j++) {
    let cells = '', highs = '';
    for (let i = 0; i < GRID; i++) {
      const [si, sj] = fromView(i, j, q);
      const n = sj * GRID + si;
      cells += colour[n] ? CODE[colour[n]] : '.';
      highs += top[n] ? (top[n] > 9 ? '+' : String(top[n])) : '.';
      tallest = Math.max(tallest, top[n]);
    }
    paint.push(`${pad(j)}  ${cells}`);
    relief.push(`${pad(j)}  ${highs}`);
  }
  return { paint: paint.join('\n'), relief: relief.join('\n'), tallest };
}

/* The model cannot see the board, so this has to carry everything a picture
   would: not just an inventory, but where things sit, how high they reach and
   what is grouped with what. The derived lines at the end matter as much as the
   list — they are what let it reason about shape instead of parts. */
function sceneSummary(withTray) {
  const out = [];
  out.push(`BOARD: ${GRID}x${GRID} studs, drawn from where the person is sitting — ` +
           `left on this map is their left. x runs 0-${GRID - 1} left to right, ` +
           `z runs 0-${GRID - 1} near to far.`);
  out.push('');
  const { paint, relief, tallest } = topDown();
  out.push('THE PICTURE, straight down. One character per stud, "." is bare board.');
  out.push(FAMILIES);
  out.push(paint);
  // Only worth sending once something actually stands above one brick; on a flat
  // drawing it is 16 identical rows saying nothing.
  if (tallest > 3) {
    out.push('');
    out.push('RELIEF, height per stud in plates (a brick is 3). Higher = raised above the rest.');
    out.push(relief);
  } else if (tallest) {
    out.push('Everything is one brick high or less - the picture is flat.');
  }
  out.push('');
  if (!placed.length) out.push('The board is empty - nothing drawn yet.');
  // Only what is actually in front of them — the library behind it runs past a
  // hundred pieces and none of the rest is on the table right now.
  if (withTray) out.push('IN THE TRAY: ' + trayParts.map(d => d.label).join(', '));
  return out.join('\n');
}

const guessPrompt = scene => `Someone is drawing with coloured pieces on a small board, seen from straight above. Here is what they have so far.

${scene}

Guess what it is meant to be. Give two or three guesses and make them properly different from one another — a plain line could be a pencil, an earthworm, or a crack in the ice. The likeliest guess is not always the best one; be playful.

Each guess is a short noun phrase said the way you would say it out loud, 4 words at most: "a pencil", "a sleepy caterpillar", "a garden path". No punctuation, no explanation.

"question" is one warm, curious line asking which it is, 8 words at most, like "Ooh, what are you making?" Never mention pieces, colours, the board or coordinates.`;

const settled = () =>
  subject  ? `They have told you what this is: ${subject}. That is settled. Never ask again, never second-guess it, and never offer alternatives — just help them build it.`
: rejected.length ? `You guessed ${rejected.join(' and ')} and they said it is none of those. Do not guess again and do not ask what it is. Pick a direction yourself and run with it — you can be surprising, even a little odd.`
: '';

const hintPrompt = scene => `Someone is building a picture out of coloured plastic pieces on a small board, seen from straight above. Here is what they have so far.

${scene}

${settled()}

Answer in two parts. Do not describe what you can see — that is settled and they are looking at it. Go straight to the doing.

"suggests" - the next small thing to add, and roughly where. One short sentence, 16 words at most, like "Why not pop a tree just to the left of it?"
"palette" - three or four colours to fill the tray with, most important first, chosen from exactly these names:
${COLOUR_LIST}
Start with what your suggestion needs - a green tree wants green and tan - and then be bold: include at least one colour that is not on the board yet, something worth reaching for even if the suggestion does not strictly need it. A tray of only the colours already in use is a dull tray, and the person can only build with what is in it.

For "suggests", name one small addition that carries what is there a step further. The next feature, not the next subject: two dots that read as eyes want a nose under them, and then a mouth. A wall wants a door. A trunk wants a leafy top. A roofline wants a chimney.

Keep the ask small:
- One to three pieces of work, and no more. This is a blunt tool and every piece is placed by hand, so a whole new animal, building or scene is far too much to ask for.
- Grow what is already there rather than starting something else somewhere else. Suggest something brand new only when the board is nearly bare.
- Point roughly where it goes: "just under them", "along the top of it", "one either side".

Rules:
- Warm and playful. Be pleased with what is there. Never sarcastic, and never call it unfinished, empty or wrong.
- Buildable out of a few coloured blocks: no lettering, no fine detail.
- Never mention LEGO, bricks, studs, cells, coordinates or the board itself.`;

const GUESS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    guesses:  { type: 'ARRAY', items: { type: 'STRING' } },
  },
  propertyOrdering: ['question', 'guesses'],
  required: ['question', 'guesses'],
};

/* No "what I can see" field. It is looking at the same board every time, so
   after the guesses are settled that line only ever restates what the person is
   already staring at. One green instruction per press reads as momentum. */
const HINT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggests: { type: 'STRING' },
    palette:  { type: 'ARRAY', items: { type: 'STRING' } },
  },
  propertyOrdering: ['suggests', 'palette'],
  required: ['suggests', 'palette'],
};
const COLOUR_NAMES = Object.keys(C);
const COLOUR_LIST = COLOUR_NAMES.join(', ');
/* Left to itself it names only what the suggestion strictly needs, which after
   a turn or two is just the colours already on the board. So the ask is widened
   here as well as in the prompt: guarantee at least one colour that is not in
   the build yet, and top the tray up to four, so there is always something new
   to reach for rather than a slowly narrowing palette. */
function widenPalette(hexes) {
  if (!hexes) return null;
  const out = [...new Set(hexes)];
  const used = new Set(placed.map(p => p.def.c));
  const fresh = COLOUR_NAMES.map(n => C[n]).filter(h => !out.includes(h) && !used.has(h));
  for (let i = fresh.length - 1; i > 0; i--) {          // so it is not the same
    const j = Math.floor(Math.random() * (i + 1));      // newcomer every time
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }
  if (!out.some(h => !used.has(h)) && fresh.length) out.push(fresh.pop());
  while (out.length < 4 && fresh.length) out.push(fresh.pop());
  return out.slice(0, 5);
}

/* Take the colours it asked for, but only ones that exist. If it named them in
   the sentence instead of the field, read them out of there. */
function toPalette(list, text) {
  let names = (Array.isArray(list) ? list : [])
    .map(n => String(n).toLowerCase().trim()).filter(n => C[n]);
  if (!names.length && text)
    names = COLOUR_NAMES.filter(n => new RegExp(`\\b${n}\\b`, 'i').test(text));
  names = [...new Set(names)].slice(0, 4);
  return names.length ? names.map(n => C[n]) : null;
}

/* The hints are one running conversation, so it can build on what it already
   said instead of starting cold each time. Two things keep that cheap: only the
   turn being sent carries the full board, and what is kept in the history is a
   one-line note of what the board looked like then. Otherwise every past turn
   would drag a whole map along with it. */
/* Settled once per build: what the thing actually is. Gemini guesses, the
   person picks, and from then on it is taken as given — the question is never
   asked twice. Waving the guesses away settles it too, differently: it means
   "none of those", which is licence to be surprising rather than to keep
   guessing. */
let subject = null, asked = false, rejected = [];

const chat = [];
const CHAT_TURNS = 8;                   // four exchanges, then the oldest falls off
let lastTally = null;

function tallyByColour() {
  const t = {};
  for (const p of placed) { const c = COLOUR_NAME[p.def.c]; t[c] = (t[c] || 0) + 1; }
  return t;
}
const boardLine = () => {
  const bits = Object.entries(tallyByColour()).map(([c, n]) => `${n} ${c}`).join(', ');
  return placed.length ? `[what I was looking at: ${bits}]` : '[what I was looking at: an empty board]';
};
/* Whether they took the advice is the most interesting thing that can have
   happened between two hints, and it is cheap to work out here. */
function sinceLast() {
  if (!lastTally) return '';
  const now = tallyByColour(), added = [];
  let removed = 0;
  for (const [c, n] of Object.entries(now)) {
    const d = n - (lastTally[c] || 0);
    if (d > 0) added.push(`${d} ${c}`);
  }
  for (const [c, n] of Object.entries(lastTally)) removed += Math.max(0, n - (now[c] || 0));
  if (!added.length && !removed) return 'They have not put anything down since you last spoke.';
  const bits = [];
  if (added.length) bits.push(`added ${added.join(', ')}`);
  if (removed) bits.push(`took away ${removed}`);
  return `Since your last idea they have ${bits.join(' and ')}.`;
}

const followPrompt = (scene, since) => `Here is the board now.

${scene}

${settled()}

${since}

Answer in the same two parts, in the same voice. Carry on from what you already said rather than repeating it: if they took your suggestion, be pleased and name the next small feature after it; if they went their own way, go with theirs.

Do not describe the board again — they can see it, and you have said it before. Go straight to the next thing to do. "suggests" is that, 16 words at most. "palette" is three or four colour names, again from exactly this list:
${COLOUR_LIST}
What the suggestion needs, plus at least one colour that is not on the board yet. Keep introducing new ones - repeating the same few every turn makes the tray dull, and there are plenty to choose from.

Same rules, and the small one especially: one to three pieces of work, growing what is already there rather than starting a new subject beside it. Warm and never sarcastic, buildable out of a few coloured blocks with no lettering or fine detail, and never mention the board itself.`;

/* Key goes in a header, never the query string — URLs get logged and shared. */
async function callGemini(prompt, schema, noThink) {
  const body = { contents: Array.isArray(prompt) ? prompt
                                                 : [{ role: 'user', parts: [{ text: prompt }] }] };
  if (schema) body.generationConfig = { responseMimeType: 'application/json', responseSchema: schema };
  // 2.5 bills thinking as output tokens, and a fourteen-word answer needs none.
  // Only the flash models accept a zero budget, so the guard stays narrow —
  // planning a whole build keeps its thinking, where it actually earns its cost.
  if (noThink && /2\.5-flash/.test(cfg.model))
    body.generationConfig = { ...body.generationConfig, thinkingConfig: { thinkingBudget: 0 } };
  const res = await fetch(`${GEMINI}/models/${cfg.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let msg = `${res.status}`;
    try { msg = JSON.parse(detail).error.message; } catch {}
    throw new Error(msg.slice(0, 140));
  }
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error('came back empty');
  return text;
}
/* Asked for rather than hard-coded, so the list is whatever this key can use. */
async function listModels(key) {
  const res = await fetch(`${GEMINI}/models`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) throw new Error(String(res.status));
  const j = await res.json();
  return (j.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => !/embedding|aqa|imagen|veo|tts/i.test(n))
    .sort();
}

/* ---------- what Gemini says ---------- */
const bubblesEl = document.getElementById('bubbles');
const SUGGEST_HOLD = 21000;
let sayToken = 0;                    // anything newer cancels a pending second beat

function bubble(text, kind, hold) {
  const el = document.createElement('div');
  el.className = 'bubble' + (kind ? ' ' + kind : '');
  el.textContent = text;
  bubblesEl.appendChild(el);
  if (hold) setTimeout(() => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 500);
  }, hold);
  return el;
}
function say(text, hold = 12000, thinking = false) {
  sayToken++;
  bubblesEl.replaceChildren();
  bubble(text, thinking ? 'thinking' : '', hold);
}
/* The one bubble that takes an answer. It does not time out: it sits there
   until it is answered or waved away. */
function askWhich(question, options, onPick, onDismiss) {
  sayToken++;
  bubblesEl.replaceChildren();
  chime();
  const el = bubble(question, 'asking', 0);
  const row = document.createElement('div');
  row.className = 'choices';
  const close = () => { el.classList.add('gone'); setTimeout(() => el.remove(), 500); };
  for (const o of options) {
    const b = document.createElement('button');
    b.className = 'choice';
    b.textContent = o;
    b.addEventListener('click', () => { close(); onPick(o); });
    row.appendChild(b);
  }
  const no = document.createElement('button');
  no.className = 'choice dismiss';
  no.textContent = 'neither';
  no.addEventListener('click', () => { close(); onDismiss(); });
  row.appendChild(no);
  el.appendChild(row);
}

/* One instruction, and the tray turning over on the same beat as the sparkle,
   so the colours arriving read as part of the idea rather than a separate
   event. The chime belongs to the question; the sparkle to an idea landing. */
function sayIdea(suggests, palette) {
  sayToken++;
  bubblesEl.replaceChildren();
  if (!suggests) return;
  sparkle();
  bubble(suggests, 'suggests', SUGGEST_HOLD);
  if (palette) { paintTray(palette); renderPalette(true); }
}

/* ---------- the two asks ---------- */
const hintBtn = document.getElementById('btnHint');
let asking = false;
async function ask(thinkingText, run) {
  if (asking) return;
  if (!cfg.key || !cfg.model) { openDebug(); say('Add a Gemini API key and pick a model first.'); return; }
  asking = true;
  hintBtn.disabled = true;
  say(thinkingText, 0, true);
  try { await run(); }
  catch (e) { say(`Gemini: ${e.message}`, 7000); }
  finally { asking = false; hintBtn.disabled = false; }
}

/* Second half of the exchange: what to add. `lead` is what the person just told
   us, and goes into the conversation as their own turn — so the history reads
   like two people talking rather than a series of unrelated requests. */
function askSuggestion(lead) {
  return ask('thinking of something...', async () => {
    const scene = sceneSummary(false);
    const body = chat.length && !lead ? followPrompt(scene, sinceLast()) : hintPrompt(scene);
    const text = lead ? `${lead}\n\n${body}` : body;
    const raw = await callGemini([...chat, { role:'user', parts:[{ text }] }], HINT_SCHEMA, true);
    let suggests = '', plan = {};
    try { plan = JSON.parse(raw); suggests = plan.suggests || ''; } catch {}
    if (!suggests) suggests = raw.replace(/^["'\s]+|["'\s]+$/g, '');   // answered in prose
    chat.push({ role:'user',  parts:[{ text: lead ? `${lead} ${boardLine()}` : boardLine() }] },
              { role:'model', parts:[{ text: suggests }] });
    while (chat.length > CHAT_TURNS) chat.shift();
    lastTally = tallyByColour();
    sayIdea(suggests, widenPalette(toPalette(plan.palette, suggests)));
  });
}

/* First press on a fresh build asks what it is; after that it never does. */
tap('btnHint', () => {
  if (asked) return askSuggestion(null);
  return ask('having a look...', async () => {
    const raw = await callGemini(
      [...chat, { role:'user', parts:[{ text: guessPrompt(sceneSummary(false)) }] }],
      GUESS_SCHEMA, true);
    let q = '', guesses = [];
    try { const j = JSON.parse(raw); q = j.question || ''; guesses = j.guesses || []; } catch {}
    guesses = guesses.map(g => String(g).trim()).filter(Boolean).slice(0, 3);
    if (!guesses.length) { asked = true; return askSuggestion(null); }   // it would not guess
    chat.push({ role:'user',  parts:[{ text: boardLine() }] },
              { role:'model', parts:[{ text: `Is it ${guesses.join(', or ')}?` }] });
    askWhich(q || 'What are you making?', guesses,
      pick => { asked = true; subject = pick; askSuggestion(`It's ${pick}.`); },
      ()   => { asked = true; rejected = guesses; });
  });
});

/* ---------- key + model panel ---------- */
const keyBtn    = document.getElementById('btnKey');
const debugEl   = document.getElementById('debug');
const apiKeyEl  = document.getElementById('apiKey');
const modelSel  = document.getElementById('modelSel');
const debugNote = document.getElementById('debugNote');

function paintKeyBtn() {
  keyBtn.classList.toggle('set', !!cfg.key);
  keyBtn.classList.toggle('unset', !cfg.key);
  keyBtn.title = cfg.key ? `Gemini key saved - ${cfg.model || 'no model picked'}` : 'No Gemini API key';
}
function fillModels(names) {
  modelSel.innerHTML = '';
  if (!names.length) {
    modelSel.appendChild(Object.assign(document.createElement('option'),
      { value: '', textContent: 'add a key to load models' }));
    return;
  }
  for (const n of names)
    modelSel.appendChild(Object.assign(document.createElement('option'), { value: n, textContent: n }));
  modelSel.value = names.includes(cfg.model) ? cfg.model
                 : (names.find(n => /flash/.test(n)) || names[0]);
}
async function loadModels(key) {
  debugNote.textContent = 'Loading models...';
  try {
    const names = await listModels(key);
    fillModels(names);
    debugNote.textContent = `${names.length} models available. Key is stored in this browser only.`;
  } catch (e) {
    fillModels([]);
    debugNote.textContent = `Could not list models (${e.message}). Check the key.`;
  }
}
function openDebug() {
  apiKeyEl.value = cfg.key;
  debugEl.hidden = false;
  if (cfg.key) loadModels(cfg.key);
  else { fillModels([]); debugNote.textContent = 'Key is stored in this browser only.'; }
}
keyBtn.addEventListener('click', openDebug);
apiKeyEl.addEventListener('change', () => {
  const k = apiKeyEl.value.trim();
  if (k) loadModels(k);
});
document.getElementById('btnKeyClose').addEventListener('click', () => { debugEl.hidden = true; });
debugEl.addEventListener('click', e => { if (e.target === debugEl) debugEl.hidden = true; });
document.getElementById('debugPanel').addEventListener('submit', e => {
  e.preventDefault();
  cfg.key = apiKeyEl.value.trim();
  cfg.model = modelSel.value || '';
  saveCfg();
  paintKeyBtn();
  debugEl.hidden = true;
});
paintKeyBtn();

/* ===================== the camera that watches back ===================== */
/* Experimental, and off unless it is asked for. The idea is that tilt should
   not be a gesture at all: nobody drags a bench to see more of its top, they
   lean over it. So the front camera watches where your head is and the view
   leans with it — up for a plan view, in for a closer look, sideways for a
   little parallax.
   No model and no library. This has to survive being flattened into one file
   with nothing left to fetch, so the head is found the cheap way: chroma is
   the axis that does the work, because skin of every shade lands in nearly
   the same small patch of Cb/Cr and it is the brightness that varies rather
   than the hue. A few rounds of mean shift then keep a hand, or a wooden door
   in the background, from dragging the answer off the face.
   What it never does is send a frame anywhere. The pixels are read into a
   64x48 buffer, counted, and thrown away. */
const CAM_W = 64, CAM_H = 48;                 // all the resolution this needs
/* Turning it on puts you here: looking down on the board at 45 degrees. It is
   the neutral every lean is measured from, so it wants to be a good place to
   build from rather than wherever the view happened to be parked. */
const HEAD_POL = Math.PI / 4;
const ZERO_N = 12;                            // ~0.4s of sightings before it commits

/* One euro. A plain exponential smoother has to choose between jitter and lag:
   wind it up and a still head stops twitching but a turned head arrives late.
   This one doesn't have to choose, because its cutoff rises with how fast the
   signal is genuinely moving — hold still and it is smoothed hard, move and it
   gets out of the way. Which matters more here than it looks: one pixel of
   wobble on a 48-row frame is 2 degrees of tilt at the default gain. */
/* A median of three in front of it, because the two kinds of jitter want two
   different tools. Chroma noise wobbles the centroid by a fraction of a row and
   the smoother handles that; a mask that flickers at the jaw or a mean shift
   that steps to the next blob throws a single frame several rows out, and to a
   smoother that looks exactly like a fast head. Three samples is enough to
   throw a lone outlier away and costs one frame. Measured on a spiky still
   signal, residual tilt swing goes from 1.76 degrees to 0.20. */
function med3() {
  const b = [];
  return v => {
    b.push(v);
    if (b.length > 3) b.shift();
    return b.length < 3 ? v : b[0] < b[1] ? (b[1] < b[2] ? b[1] : (b[0] < b[2] ? b[2] : b[0]))
                                          : (b[0] < b[2] ? b[0] : (b[1] < b[2] ? b[2] : b[1]));
  };
}
function euro(minCut, beta, dCut = 1) {
  let x = null, dx = 0, tPrev = 0;
  const alpha = (cut, dt) => 1 / (1 + 1 / (2 * Math.PI * cut) / dt);
  return (v, t) => {
    if (x === null || t <= tPrev) { x = v; tPrev = t; return v; }
    const dt = Math.max(t - tPrev, 1e-3);
    tPrev = t;
    dx += alpha(dCut, dt) * ((v - x) / dt - dx);
    x  += alpha(minCut() + beta * Math.abs(dx), dt) * (v - x);
    return x;
  };
}
const HEAD = {
  on:false, live:false, seen:false, note:'',
  tilt:0, turn:0, push:1,                     // what the view actually reads off it
  x:0, y:0, s:0, x0:null, y0:0, s0:0,         // the smoothed reading, and its zero
  zn:0, zx:0, zy:0, zs:0,                     // ...which is averaged, not snatched
  gTilt:80, gTurn:20, gZoom:50, ease:35,      // the knobs, in the panel's own units
  mirror:true, spin:0,
};
Object.assign(HEAD, cfg.head || {});
const saveHead = () => {
  cfg.head = { gTilt:HEAD.gTilt, gTurn:HEAD.gTurn, gZoom:HEAD.gZoom,
               ease:HEAD.ease, mirror:HEAD.mirror, spin:HEAD.spin, on:HEAD.on };
  saveCfg();
};

let camVid = null, camCtx = null, camStream = null, camAt = 0;
// the slider is read through a closure so it stays live while you drag it
const cut = () => Math.max(HEAD.ease, 1) / 50;
let smX = euro(cut, 2.5), smY = euro(cut, 2.5), smS = euro(cut, 2.5);
let mdX = med3(), mdY = med3(), mdS = med3();
const camMask = new Uint8Array(CAM_W * CAM_H);   // one buffer, reused every frame

/* One frame in, one head out — or null, when there is nothing face-shaped in
   shot and the view should simply stay where it was rather than snapping back
   to the middle. */
function findHead(px) {
  let sx = 0, sy = 0, n = 0;
  for (let j = 0, p = 0, m = 0; j < CAM_H; j++)
    for (let i = 0; i < CAM_W; i++, p += 4, m++) {
      const r = px[p], g = px[p + 1], b = px[p + 2];
      const y  =  0.299 * r + 0.587 * g + 0.114 * b;
      const cb = -0.169 * r - 0.331 * g + 0.500 * b + 128;
      const cr =  0.500 * r - 0.419 * g - 0.081 * b + 128;
      const hit = (y > 44 && cb >= 77 && cb <= 133 && cr >= 133 && cr <= 180) ? 1 : 0;
      camMask[m] = hit;
      if (hit) { sx += i; sy += j; n++; }
    }
  if (n < CAM_W * CAM_H * 0.008) return null;      // nothing face-sized in shot
  let cx = sx / n, cy = sy / n, cnt = n, rad = CAM_W * 0.45;
  for (let k = 0; k < 3; k++) {                    // mean shift onto the biggest patch
    let ax = 0, ay = 0, c = 0;
    for (let j = 0, m = 0; j < CAM_H; j++)
      for (let i = 0; i < CAM_W; i++, m++) {
        if (!camMask[m]) continue;
        const dx = i - cx, dy = j - cy;
        if (dx * dx + dy * dy < rad * rad) { ax += i; ay += j; c++; }
      }
    if (!c) break;
    cx = ax / c; cy = ay / c; cnt = c; rad *= 0.8;
  }
  // Area stands in for distance: a face twice as close covers four times as
  // much frame, so its square root is the one that moves linearly.
  return { x: cx / CAM_W - 0.5, y: cy / CAM_H - 0.5, s: Math.sqrt(cnt) / CAM_W, cx, cy,
           r: Math.sqrt(cnt / Math.PI) };
}

/* The frame does not always arrive the way up the screen is — an iPad held in
   landscape has its camera along one edge — and a front camera is a mirror.
   Both are one line each here, and both are visible in the preview, which is
   the only honest way to set them. */
function orient(p) {
  let x = p.x, y = p.y;
  for (let k = 0; k < HEAD.spin; k++) { const t = x; x = -y; y = t; }
  return { x: HEAD.mirror ? -x : x, y, s: p.s };
}

/* Naming the exception is not a diagnosis. NotAllowedError in particular means
   three completely different things with three completely different fixes, and
   the browser will not say which — so work it out here, because "no camera
   (NotAllowedError)" sends nobody anywhere. */
async function whyRefused(e) {
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')
    return 'no front camera on this device.';
  if (e.name !== 'NotAllowedError' && e.name !== 'SecurityError')
    return `the camera failed to start (${e.name}).`;
  // An embedded page is never given a camera unless the page embedding it says
  // so, and it cannot ask. This is the artifact, and no setting will fix it.
  if (window.self !== window.top)
    return 'this copy is embedded in another page, which is never handed a ' +
           'camera. Open the hosted build in its own tab and turn it on there.';
  // Chrome answers this; Safari does not know the name and throws.
  let state = '';
  try { state = (await navigator.permissions.query({ name:'camera' })).state; } catch {}
  if (state === 'denied')
    return 'this site is blocked from using the camera. Chrome: click the ' +
           'camera or padlock icon by the address bar, set Camera to Allow, ' +
           'reload. iPad: the "aA" menu > Website Settings > Camera > Allow.';
  return 'permission was refused. Tick the box again and choose Allow. If no ' +
         'prompt appears, the browser itself may lack camera access — on a Mac ' +
         'that is System Settings > Privacy & Security > Camera.';
}

async function headStart() {
  if (!navigator.mediaDevices?.getUserMedia) {
    HEAD.on = false;
    // Worth being specific: this is the failure everyone hits first, and the
    // fix is a different URL rather than a different setting.
    HEAD.note = window.isSecureContext
      ? 'this browser will not hand over a camera.'
      : 'a camera needs https. Open the hosted build, not the plain http LAN address.';
    return paintHead();
  }
  HEAD.note = 'asking for the camera...';
  paintHead();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'user', width:{ ideal:320 }, height:{ ideal:240 } }, audio:false });
  } catch (e) {
    HEAD.on = false;
    HEAD.note = await whyRefused(e);
    return paintHead();
  }
  if (!camVid) {
    camVid = document.createElement('video');
    camVid.playsInline = true; camVid.muted = true; camVid.autoplay = true;
    const c = document.createElement('canvas');
    c.width = CAM_W; c.height = CAM_H;
    camCtx = c.getContext('2d', { willReadFrequently:true });
  }
  camVid.srcObject = camStream;
  try { await camVid.play(); } catch {}
  HEAD.live = true;
  headZero();
  HEAD.note = 'looking for you...';
  paintHead();
}
/* Every way in re-zeroes: turning it on, and CENTRE ME. Both mean the same
   thing — wherever you are now is straight ahead, and straight ahead is the
   45-degree view of the board. */
function headZero() {
  HEAD.x0 = null; HEAD.zn = 0; HEAD.zx = 0; HEAD.zy = 0; HEAD.zs = 0;
  HEAD.tilt = 0; HEAD.turn = 0; HEAD.push = 1;
  smX = euro(cut, 2.5); smY = euro(cut, 2.5); smS = euro(cut, 2.5);
  mdX = med3(); mdY = med3(); mdS = med3();
  view.bpol = HEAD_POL;
}
function headStop() {
  HEAD.live = false; HEAD.seen = false;
  HEAD.tilt = 0; HEAD.turn = 0; HEAD.push = 1;
  camStream?.getTracks().forEach(t => t.stop());
  camStream = null;
  if (camVid) camVid.srcObject = null;
  headView.getContext('2d').clearRect(0, 0, headView.width, headView.height);
  HEAD.note = 'off. The board tilts by dragging past the bench instead.';
  paintHead();
}

function stepHead(now) {
  if (!HEAD.live || now - camAt < 33) return;     // 30Hz is plenty, and cheap
  camAt = now;
  if (!camVid.videoWidth) return;
  camCtx.drawImage(camVid, 0, 0, CAM_W, CAM_H);
  const img = camCtx.getImageData(0, 0, CAM_W, CAM_H);
  const raw = findHead(img.data);
  // The preview and the readout exist to be tuned against. Drawing them at
  // 30Hz behind a closed panel is pure waste, so they only run when open.
  const showing = !debugEl.hidden;
  if (showing) drawHeadView(img, raw);
  HEAD.seen = !!raw;
  if (!raw) { HEAD.note = 'cannot see a face.'; if (showing) paintHead(); return; }

  const p = orient(raw);
  const t = now / 1000;
  HEAD.x = smX(mdX(p.x), t); HEAD.y = smY(mdY(p.y), t); HEAD.s = smS(mdS(p.s), t);
  if (HEAD.x0 === null) {
    // A single frame is a coin toss to call straight-ahead from, so average a
    // few. Nothing leans until it has committed.
    HEAD.zn++; HEAD.zx += HEAD.x; HEAD.zy += HEAD.y; HEAD.zs += HEAD.s;
    if (HEAD.zn >= ZERO_N) {
      HEAD.x0 = HEAD.zx / HEAD.zn; HEAD.y0 = HEAD.zy / HEAD.zn; HEAD.s0 = HEAD.zs / HEAD.zn;
      HEAD.note = 'watching. CENTRE ME puts straight-ahead back where you are.';
    } else {
      HEAD.note = 'hold still...';
    }
    HEAD.tilt = 0; HEAD.turn = 0; HEAD.push = 1;
    if (showing) paintHead();
    return;
  }
  const D = Math.PI / 180;
  // Head up means a smaller y in the frame, and a smaller polar angle is the
  // view from above — so this reads the right way round with no sign flip.
  HEAD.tilt = (HEAD.y - HEAD.y0) * HEAD.gTilt * D;
  HEAD.turn = (HEAD.x - HEAD.x0) * HEAD.gTurn * D;
  // Lean in and the face grows; how much of that true perspective is honoured
  // is the knob, because all of it is more than anyone wants.
  HEAD.push = 1 + (HEAD.s0 / Math.max(HEAD.s, 1e-3) - 1) * (HEAD.gZoom / 100);
  if (showing) paintHead();
}

/* ---------- the panel ---------- */
const headView = document.getElementById('headView');
const headNote = document.getElementById('headNote');
const headOut  = document.getElementById('headOut');
const headOnEl = document.getElementById('headOn');
const headMirEl = document.getElementById('headMirror');
const headBox = document.getElementById('headBox');
const headSpinBtn = document.getElementById('btnHeadSpin');
const KNOBS = [
  ['hTilt', 'gTilt', v => `${v}°`],
  ['hTurn', 'gTurn', v => `${v}°`],
  ['hZoom', 'gZoom', v => `${v}%`],
  ['hEase', 'ease',  v => `${v}%`],
].map(([id, key, fmt]) =>
  ({ key, fmt, el: document.getElementById(id), out: document.getElementById(id + 'V') }));

// The little frame is drawn through the same 64x48 buffer that was measured,
// so what you are looking at is exactly what the tracker got.
const previewBuf = document.createElement('canvas');
previewBuf.width = CAM_W; previewBuf.height = CAM_H;
const previewCtx = previewBuf.getContext('2d');
function drawHeadView(img, raw) {
  const g = headView.getContext('2d');
  const W = headView.width, H = headView.height;
  previewCtx.putImageData(img, 0, 0);
  g.save();
  if (HEAD.mirror) { g.translate(W, 0); g.scale(-1, 1); }
  g.imageSmoothingEnabled = false;
  g.drawImage(previewBuf, 0, 0, W, H);
  if (raw) {
    const x = raw.cx / CAM_W * W, y = raw.cy / CAM_H * H, r = Math.max(raw.r / CAM_W * W, 6);
    g.strokeStyle = '#1f8a4c'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x - r - 5, y); g.lineTo(x + r + 5, y);
    g.moveTo(x, y - r - 5); g.lineTo(x, y + r + 5); g.stroke();
  }
  g.restore();
}
function paintHead() {
  headNote.textContent = HEAD.note;
  headBox.hidden = !HEAD.live;
  headOut.textContent = HEAD.live && HEAD.seen
    ? `x ${HEAD.x.toFixed(2)}  y ${HEAD.y.toFixed(2)}  size ${HEAD.s.toFixed(2)}` +
      `  →  tilt ${(HEAD.tilt * 180 / Math.PI).toFixed(0)}°` +
      `  turn ${(HEAD.turn * 180 / Math.PI).toFixed(0)}°` +
      `  zoom ${(HEAD.push * 100).toFixed(0)}%`
    : '—';
  for (const q of KNOBS) { q.el.value = HEAD[q.key]; q.out.textContent = q.fmt(HEAD[q.key]); }
  headOnEl.checked = HEAD.on;
  headMirEl.checked = HEAD.mirror;
  headSpinBtn.textContent = `TURN INPUT ${HEAD.spin * 90}°`;
  paintEyeBtn();
}
/* Its own way in, and it says at a glance whether the camera is running. The
   panel is one sheet with two halves, so this opens the same thing the key
   does and scrolls to the half you asked for. */
const eyeBtn = document.getElementById('btnEye');
eyeBtn.addEventListener('click', () => {
  openDebug();
  headOnEl.scrollIntoView({ block:'center' });
});
const paintEyeBtn = () => {
  eyeBtn.classList.toggle('set', HEAD.live);
  eyeBtn.title = HEAD.live ? 'Head tracking on' : 'Head tracking (experimental)';
};
headOnEl.addEventListener('change', () => {
  HEAD.on = headOnEl.checked;
  saveHead();
  HEAD.on ? headStart() : headStop();
});
headMirEl.addEventListener('change', () => { HEAD.mirror = headMirEl.checked; saveHead(); });
for (const q of KNOBS)
  q.el.addEventListener('input', e => { HEAD[q.key] = +e.target.value; saveHead(); paintHead(); });
document.getElementById('btnHeadZero').addEventListener('click', headZero);
headSpinBtn.addEventListener('click', () => {
  HEAD.spin = (HEAD.spin + 1) & 3; headZero(); saveHead(); paintHead();
});
HEAD.note = HEAD.on ? 'tap the board once to let the camera start.'
                    : 'off. The board tilts by dragging past the bench instead.';
paintHead();

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
    // The same tap buys the camera as buys the sound: neither is handed over
    // without one, and this is the only plain tap the app ever gets.
    if (HEAD.on) headStart();
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
  applyCamera(dt);
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
  sweep(dt);
  tickHolds(now);
  stepHead(now);
  stepDemolition(dt);
  stepFlight(dt);
  renderer.render(scene, camera);
  if (++frames >= 30) {
    statsEl.textContent = `${Math.round(frames * 1000 / (now - fpsT))} fps · ${placed.length} bricks · ${drags.size + nav.size} touches · audio ${audioState()}`
      + (HEAD.live ? ` · head ${HEAD.seen ? 'seen' : 'lost'}` : '');
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
window.__kiosk = { placed, loose, flying, holds, pickList, heights, cfg, sceneSummary, say, sayIdea, askWhich, chat, sinceLast, get subject(){ return subject; }, get asked(){ return asked; }, get rejected(){ return rejected; }, toPalette, widenPalette, scramble, pickParts, get trayParts(){ return trayParts; }, get trayColours(){ return trayColours; }, get tray(){ return tray; }, assemblyOf, toLocal, turnAsm, solveAsm, view, board, desk, HEAD, euro, med3, headZero, findHead, groundAt, onPlate, sweep, stepCoast, get coast(){ return coast; }, get grip(){ return grip; }, drags, nav, CATALOG, solve, hitList, camera, scene, build, ray, ndc, THREE, gridTurns, popSound, boardY, solveAt, placeX, place, matable, canMate, audioState, launch, stepFlight, stepDemolition, tickHolds, chuck, isFree, detach, demolish, demolition, get flickOn(){ return flickOn; }, get manualRot(){ return manualRot; } };
