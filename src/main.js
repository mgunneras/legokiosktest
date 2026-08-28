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
/* w = studs along X, d = studs along Z, p = height in plates. `page` is only
   which tray page it appears on — Gemini always sees the whole catalogue.
   Shapes are real elements; the part numbers are there so they can be looked up.
   `run` is how many studs a slope falls across, `flat` how many studs of level
   top a curve keeps before it turns over. Footprint and height are unchanged by
   shape, so placement, stacking and the grid never learn about any of this. */
const CATALOG = [
  // --- page 0: bricks and plates ---
  { id:'b1x1', w:1, d:1, p:3, c:C['red'],    page:0 },
  { id:'b1x2', w:2, d:1, p:3, c:C['blue'],   page:0 },
  { id:'b1x3', w:3, d:1, p:3, c:C['yellow'], page:0 },
  { id:'b1x4', w:4, d:1, p:3, c:C['green'],  page:0 },
  { id:'b1x6', w:6, d:1, p:3, c:C['orange'], page:0 },
  { id:'b1x8', w:8, d:1, p:3, c:C['purple'], page:0 },
  { id:'b2x2', w:2, d:2, p:3, c:C['white'],  page:0 },
  { id:'b2x3', w:3, d:2, p:3, c:C['medium azure'],  page:0 },
  { id:'b2x4', w:4, d:2, p:3, c:C['light bluish gray'],   page:0 },
  { id:'b2x6', w:6, d:2, p:3, c:C['lime'],   page:0 },
  { id:'p2x2', w:2, d:2, p:1, c:C['tan'],    page:0 },
  { id:'p2x4', w:4, d:2, p:1, c:C['black'],  page:0 },

  // --- page 1: slopes. A brick-height fall across one stud is ~50 degrees,
  //     which is the element everyone calls a 45; across two studs it is ~31,
  //     the one called a 33. The names are LEGO's, the angles are geometry's. ---
  { id:'s3040',  w:2, d:1, p:3, c:C['red'],    page:1, shape:'slope',    run:1, part:'3040',  label:'slope 45 2x1' },
  { id:'s3039',  w:2, d:2, p:3, c:C['blue'],   page:1, shape:'slope',    run:1, part:'3039',  label:'slope 45 2x2' },
  { id:'s3037',  w:4, d:2, p:3, c:C['yellow'], page:1, shape:'slope',    run:1, part:'3037',  label:'slope 45 2x4' },
  { id:'s4286',  w:3, d:1, p:3, c:C['green'],  page:1, shape:'slope',    run:2, part:'4286',  label:'slope 33 3x1' },
  { id:'s3298',  w:3, d:2, p:3, c:C['orange'], page:1, shape:'slope',    run:2, part:'3298',  label:'slope 33 3x2' },
  { id:'s54200', w:1, d:1, p:2, c:C['white'],  page:1, shape:'slope',    run:1, part:'54200', label:'cheese slope' },
  { id:'s85984', w:2, d:1, p:2, c:C['medium azure'],  page:1, shape:'slope',    run:1, part:'85984', label:'slope 30 2x1' },
  { id:'s3665',  w:2, d:1, p:3, c:C['light bluish gray'],   page:1, shape:'invslope', run:1, part:'3665',  label:'inverted 2x1' },
  { id:'s3660',  w:2, d:2, p:3, c:C['tan'],    page:1, shape:'invslope', run:1, part:'3660',  label:'inverted 2x2' },

  // --- page 2: curves and round parts ---
  { id:'c11477', w:2, d:1, p:3, c:C['red'],    page:2, shape:'curve', flat:1, part:'11477', label:'curve 2x1' },
  { id:'c50950', w:3, d:1, p:3, c:C['blue'],   page:2, shape:'curve', flat:1, part:'50950', label:'curve 3x1' },
  { id:'c61678', w:4, d:1, p:3, c:C['yellow'], page:2, shape:'curve', flat:1, part:'61678', label:'curve 4x1' },
  { id:'c15068', w:2, d:2, p:3, c:C['green'],  page:2, shape:'curve', flat:1, part:'15068', label:'curve 2x2' },
  { id:'c6091',  w:2, d:1, p:4, c:C['purple'], page:2, shape:'curve', flat:0, part:'6091',  label:'curved top' },
  { id:'r3062',  w:1, d:1, p:3, c:C['orange'], page:2, shape:'round', part:'3062',  label:'round 1x1' },
  { id:'r3941',  w:2, d:2, p:3, c:C['lime'],   page:2, shape:'round', part:'3941',  label:'round 2x2' },
  { id:'r98138', w:1, d:1, p:1, c:C['black'],  page:2, shape:'round', tile:true, part:'98138', label:'round tile 1x1' },
  { id:'r4150',  w:2, d:2, p:1, c:C['tan'],    page:2, shape:'round', tile:true, part:'4150',  label:'round tile 2x2' },
];
/* The tray can be re-tinted to whatever Gemini just suggested. Nothing in the
   catalogue is mutated: a piece dragged out carries a *copy* of its definition
   with the colour of the moment baked in, so anything already on the board keeps
   the colour it was built in even after the tray moves on. */
const GI = new Map();
let tray = null;                       // null = each piece's own colour
const colourOf = def => tray ? tray[(GI.get(def) ?? 0) % tray.length] : def.c;

const PAGE_NAMES = ['BRICKS', 'SLOPES', 'CURVES'];
CATALOG.forEach((d, i) => GI.set(d, i));
const PAGES = PAGE_NAMES.map((_, n) => CATALOG.filter(d => d.page === n));
const label = b => b.label || `${b.d}x${b.w}${b.p === 1 ? ' plate' : ''}`;

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
  const s = new THREE.Shape();
  if (def.shape === 'slope') {                  // high at +x, falling to nothing
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
function studAt(def, i) {
  if (def.tile) return false;
  if (def.shape === 'slope') return i >= def.w - def.run;
  if (def.shape === 'curve') return i >= def.w - (def.flat ?? 1);
  return true;                                  // plain, inverted and round: all of it
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
    if (!studAt(def, i)) continue;
    for (let j = 0; j < def.d; j++) {
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

/* Height alone cannot describe a slope: the angled half of one stands as tall as
   the rest but has no studs on it, so nothing may sit there. `matable` is that
   second fact, per column — 1 where the top of the stack can take a piece. */
const matable = new Uint8Array(GRID * GRID).fill(1);
const H = (i, j) => heights[j * GRID + i];
const setH = (i, j, v) => { heights[j * GRID + i] = v; };
const canMate = (i, j) => matable[j * GRID + i] === 1;

/* Write a piece into both maps. Rotation is a real quarter turn of the piece,
   not a swap of its width and depth — for a wedge those are different solids —
   so the piece's own column `li` lands at a different world column each way. */
function stamp(def, sol, rot, top) {
  for (let li = 0; li < def.w; li++) {
    const studs = studAt(def, li) ? 1 : 0;
    for (let lj = 0; lj < def.d; lj++) {
      const wi = rot ? sol.i0 + lj : sol.i0 + li;
      const wj = rot ? sol.j0 + (def.w - 1 - li) : sol.j0 + lj;
      setH(wi, wj, top);
      matable[wj * GRID + wi] = studs;
    }
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
function turnAsm(asm, R) {
  if (!R) return asm;
  return { W: asm.D, D: asm.W, H: asm.H,
    parts: asm.parts.map(p => ({ def:p.def, rot:p.rot ^ 1, dh:p.dh,
      di:p.dj, dj:asm.W - p.di - p.fw, fw:p.fd, fd:p.fw })) };
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
    if (hit && hit.object.userData.owner) startHold(e, hit.object.userData.owner, hit.point);
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
/* ...and where does the brick under `ray` land? null if it misses the build */
function solveRay(def, rot, gx = 0, gz = 0) {
  const hit = ray.intersectObjects(hitList, false)[0];
  if (!hit) return null;
  // nudge into the column we actually hit (side faces sit exactly on a seam),
  // then back off by the grab so the piece lands where the finger is holding it
  return solveAt(hit.point.x - hit.face.normal.x * 0.02 - gx,
                 hit.point.z - hit.face.normal.z * 0.02 - gz, def, rot);
}
const solve = (x, y, def, rot) => castFrom(x, y) ? solveRay(def, rot) : null;
function solveRayAsm(asm, R, gx = 0, gz = 0) {
  const hit = ray.intersectObjects(hitList, false)[0];
  if (!hit) return null;
  return solveAsm(hit.point.x - hit.face.normal.x * 0.02 - gx,
                  hit.point.z - hit.face.normal.z * 0.02 - gz, asm, R);
}
const overBoard = p => Math.abs(p.x) <= GRID / 2 && Math.abs(p.z) <= GRID / 2;

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
  nav.delete(pid);                                // this is a drag now, not an orbit
  pinch = null;
  pluckSound(true);
  if (rec.kind === 'loose') {                     // a desk piece is only ever itself
    const def = rec.def;
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
  const grab = h.hit && { x: h.hit.x - placeX(i0, asm.W), z: h.hit.z - placeX(j0, asm.D) };
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
const gridRot = s => gridTurns(s) & 1;

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
              rot0: seedRot === undefined ? screenParity(def) : ((seedRot - manualRot) & 1),
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

  const turns = gridTurns(s), rot = turns & 1;
  if (!s.held) {                                    // built once, then only turned
    s.held = s.asm ? buildAssembly(s.asm) : buildBrick(s.def);
    scene.add(s.held);
    s.yaw = turns * (Math.PI / 2);
    if (s.asm) { s.ghost = buildAssembly(s.asm, true); build.add(s.ghost); }
  }
  // The hand twists; it doesn't teleport. The ghost still snaps, because it is
  // answering "where does this land", not "what is my hand doing".
  s.yawTo = turns * (Math.PI / 2);
  s.yaw += (s.yawTo - s.yaw) * 0.32;
  s.held.rotation.y = s.yaw;
  if (s.asm) {
    s.ghost.rotation.y = rot * (Math.PI / 2);       // a lump only ever turns
    s.rot = rot;
  } else if (rot !== s.rot) {                       // snapped to the other grid axis
    if (s.ghost) build.remove(s.ghost);
    s.ghost = buildBrick(s.def, true);
    s.ghost.rotation.y = rot * (Math.PI / 2);
    build.add(s.ghost);                             // sticks to the board, bounce and all
    s.rot = rot;
  }

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
    const y  = (sol ? sol.h * PLATE : 0) + HOVER;
    hoverPlane.constant = -y;
    if (ray.ray.intersectPlane(hoverPlane, tmpV)) {
      // sit just above the fingertip, so the finger and the brick don't hide
      // the landing ghost directly beneath them on the same screen ray
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const hx = s.gx * Math.cos(s.yaw) + s.gz * Math.sin(s.yaw);
      const hz = -s.gx * Math.sin(s.yaw) + s.gz * Math.cos(s.yaw);
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
  for (const p of t.parts) {
    const at = from.clone();
    at.x += (p.di - t.W / 2 + 0.5) * 0.9;
    at.z += (p.dj - t.D / 2 + 0.5) * 0.9;
    at.y += p.dh * PLATE;
    discard(p.def, p.rot, at, new THREE.Vector3());
  }
}

/* ---------- the flick ---------- */
/* Whether a throw sticks is decided here, at launch, not on arrival — a dud is
   committed to before it ever touches down, so it tumbles the whole way in. */
function launch(def, rot, from, vel) {
  const g = oriented(def, rot);
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
  const g = oriented(def, rot);
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
const pageStateEl = document.getElementById('pageState');
let page = 0;

/* The tray shows one page at a time; the catalogue behind it is always whole,
   so Gemini's piece indices stay valid whichever page happens to be open. */
function renderPalette(flash) {
  paletteEl.replaceChildren();
  PAGES[page].forEach((def, idx) => {
    const el = document.createElement('div');
    el.className = 'brick' + (idx === 0 ? ' active' : '');
    const sw = document.createElement('div');
    sw.className = 'swatch' + (def.shape ? ' ' + def.shape : '');
    sw.style.background = colourOf(def);
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
      beginDrag(e, { ...def, c: colourOf(def) }, el);
    });
  });
  pageStateEl.textContent = `${PAGE_NAMES[page]} ${page + 1}/${PAGES.length}`;
}

const tap = (id, fn) => document.getElementById(id)
  .addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
renderPalette();
tap('btnPage', () => { page = (page + 1) % PAGES.length; renderPalette(); });
/* No button for this any more — throwing earned its place. F still toggles it,
   for when a flick needs ruling out while chasing something else.           */
const toggleFlick = () => { flickOn = !flickOn; };
tap('btnUndo', undo);
tap('btnClear', () => {
  demolish();
  chat.length = 0;                       // new build, new conversation
  lastTally = null;
  tray = null; renderPalette();          // ...and the tray back to its own colours
});
tap('btnHome', () => { view.taz = HOME.az; view.tpol = HOME.pol; view.trad = HOME.rad; });
tap('btnFull', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
addEventListener('keydown', e => {
  // No button for this any more: spinning the plate turns the brick and is the
  // more discoverable of the two. R stays as a fallback on a fixed view.
  if (e.key === 'r' || e.key === 'R') manualRot ^= 1;
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
  let tallest = 0;
  for (let j = 0; j < GRID; j++) {
    let cells = '', highs = '';
    for (let i = 0; i < GRID; i++) {
      const n = j * GRID + i;
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
  out.push(`BOARD: ${GRID}x${GRID} studs, seen from directly above. x runs 0-${GRID - 1} ` +
           `left to right, z runs 0-${GRID - 1} top to bottom of the map below.`);
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
  if (withTray) {
    // Extents are written as x3z1 rather than "1x3". A bare "1x3" gets read as
    // width-by-depth, which is the transpose of the truth, and every piece then
    // gets planned lying the wrong way round.
    out.push('TRAY. index=colour then x<studs along x>z<studs along z>:');
    const kind = d => d.shape === 'invslope' ? '-inv' : d.shape ? '-' + d.shape
                    : d.p === 1 ? '-flat' : '';
      out.push(CATALOG.map((d, i) =>
      `${i}=${CODE[COLOUR_NAME[colourOf(d)]]}x${d.w}z${d.d}${kind(d)}`).join('  '));
  }
  return out.join('\n');
}

const hintPrompt = scene => `Someone is building a picture out of coloured plastic pieces on a small board, seen from straight above. Here is what they have so far.

${scene}

Answer in two parts.

"sees" - what you can see, said with delight. One short sentence, 12 words at most, like "Oh, that's a little house on a hill!"
"suggests" - the next small thing to add, and roughly where. One short sentence, 16 words at most, like "Why not pop a tree just to the left of it?"
"palette" - three or four colours to fill the tray with, most important first, chosen from exactly these names:
${COLOUR_LIST}
Start with what your suggestion needs - a green tree wants green and tan - and then be bold: include at least one colour that is not on the board yet, something worth reaching for even if the suggestion does not strictly need it. A tray of only the colours already in use is a dull tray, and the person can only build with what is in it.

For "suggests", name one small addition that carries what is there a step further. The next feature, not the next subject: two dots that read as eyes want a nose under them, and then a mouth. A wall wants a door. A trunk wants a leafy top. A roofline wants a chimney.

Keep the ask small:
- One to three pieces of work, and no more. This is a blunt tool and every piece is placed by hand, so a whole new animal, building or scene is far too much to ask for.
- Grow what is already there rather than starting something else somewhere else. Suggest something brand new only when the board is nearly bare.
- Point roughly where it goes: "just under them", "along the top of it", "one either side".

Rules for both parts:
- Warm and playful. Be pleased with what is there. Never sarcastic, and never call it unfinished, empty or wrong.
- Buildable out of a few coloured blocks: no lettering, no fine detail.
- Never mention LEGO, bricks, studs, cells, coordinates or the board itself.`;

const HINT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sees:     { type: 'STRING' },
    suggests: { type: 'STRING' },
    palette:  { type: 'ARRAY', items: { type: 'STRING' } },
  },
  propertyOrdering: ['sees', 'suggests', 'palette'],
  required: ['sees', 'suggests', 'palette'],
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

${since}

Answer in the same two parts, in the same voice. Carry on from what you already said rather than repeating it: if they took your suggestion, be pleased and name the next small feature after it; if they went their own way, go with theirs.

"sees" is what you can see now, 12 words at most. "suggests" is the next small thing, 16 words at most. "palette" is three or four colour names, again from exactly this list:
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
const SEES_HOLD = 24000, SUGGEST_HOLD = 21000, SECOND_BEAT = 2800;
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
/* What it sees, then a beat, then what to do about it — so the first has been
   read by the time the second arrives, rather than both landing as one block. */
function sayPair(sees, suggests, palette) {
  const mine = ++sayToken;
  bubblesEl.replaceChildren();
  chime();
  if (sees) bubble(sees, 'sees', SEES_HOLD);
  if (!suggests) return;
  setTimeout(() => {
    if (mine !== sayToken) return;   // a newer answer already took the screen
    sparkle();
    bubble(suggests, 'suggests', SUGGEST_HOLD);
    // The tray turns over on the same beat as the sparkle, so the colours
    // arriving reads as part of the suggestion rather than a separate event.
    if (palette) { tray = palette; renderPalette(true); }
  }, sees ? SECOND_BEAT : 0);
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

tap('btnHint', () => ask('thinking of something...', async () => {
  const scene = sceneSummary(false);
  const asked = chat.length ? followPrompt(scene, sinceLast()) : hintPrompt(scene);
  // Send the live turn without committing it: a failed call must not leave a
  // dangling user turn behind, which would break the alternation next time.
  const raw = await callGemini([...chat, { role:'user', parts:[{ text: asked }] }],
                               HINT_SCHEMA, true);
  let sees = '', suggests = '', plan = {};
  try { plan = JSON.parse(raw); sees = plan.sees || ''; suggests = plan.suggests || ''; } catch {}
  if (!sees && !suggests) {              // answered in prose: split at the first stop
    const m = raw.match(/^([\s\S]*?[.!?])\s+([\s\S]+)$/);
    sees = (m ? m[1] : raw).trim();
    suggests = m ? m[2].trim() : '';
  }
  chat.push({ role:'user',  parts:[{ text: boardLine() }] },   // kept small on purpose
             { role:'model', parts:[{ text: `${sees} ${suggests}`.trim() }] });
  while (chat.length > CHAT_TURNS) chat.shift();
  lastTally = tallyByColour();
  sayPair(sees, suggests, widenPalette(toPalette(plan.palette, suggests)));
}));

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
window.__kiosk = { placed, loose, flying, holds, pickList, heights, cfg, sceneSummary, say, sayPair, chat, sinceLast, toPalette, widenPalette, colourOf, get tray(){ return tray; }, assemblyOf, toLocal, turnAsm, solveAsm, view, drags, nav, CATALOG, solve, hitList, camera, scene, build, ray, ndc, THREE, gridRot, gridTurns, popSound, boardY, solveAt, placeX, place, matable, canMate, audioState, launch, stepFlight, stepDemolition, tickHolds, chuck, isFree, detach, demolish, demolition, get flickOn(){ return flickOn; }, get manualRot(){ return manualRot; } };
