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

const scene = new THREE.Scene();
scene.background = new THREE.Color('#222a3d');
scene.fog = new THREE.Fog('#222a3d', 52, 96);

const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 200);
const TARGET = new THREE.Vector3(0, 1.2, 0);

scene.add(new THREE.HemisphereLight('#eaf3ff', '#5d687e', 1.25));
const sun = new THREE.DirectionalLight('#fffaf0', 1.5);
sun.position.set(9, 16, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.radius = 2;
const sc = sun.shadow.camera;
sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 46;
scene.add(sun);
const rim = new THREE.DirectionalLight('#9dc0ff', 0.55);
rim.position.set(-8, 6, -9);
scene.add(rim);

/* ---------- shared geometry ---------- */
const studGeo = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 14);
const boxGeo  = new THREE.BoxGeometry(1, 1, 1);
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
function audio() {
  if (actx === null) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { actx = false; return null; }
    actx  = new AC();
    master = actx.createGain();
    master.gain.value = 0.45;
    master.connect(actx.destination);
    const n = Math.floor(actx.sampleRate * 0.05);
    noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
  }
  if (!actx) return null;
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
/* audio may only start inside a gesture — arm it on the kiosk's first touch */
addEventListener('pointerdown', audio, { capture: true });

function popSound(level) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.001;
  const f = 300 * Math.pow(1.07, level) * (0.96 + Math.random() * 0.08);

  const osc = a.createOscillator(), og = a.createGain();   // the "pop" body
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(f * 2.4, t);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.045);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  osc.connect(og).connect(master);
  osc.start(t); osc.stop(t + 0.14);

  const src = a.createBufferSource(), bp = a.createBiquadFilter(), ng = a.createGain();
  src.buffer = noiseBuf;                                   // the plastic transient
  bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.1;
  ng.gain.setValueAtTime(0.35, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(bp).connect(ng).connect(master);
  src.start(t); src.stop(t + 0.06);
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
  const base = new THREE.Mesh(boxGeo, new THREE.MeshPhongMaterial({ color:'#3f9159', shininess:24 }));
  base.scale.set(GRID, PLATE, GRID);
  base.position.y = -PLATE / 2;
  base.receiveShadow = true;
  base.userData.isBase = true;
  plateGroup.add(base);

  const inst = new THREE.InstancedMesh(studGeo, new THREE.MeshPhongMaterial({ color:'#48a065', shininess:24 }), GRID * GRID);
  inst.receiveShadow = true;
  inst.raycast = () => {};
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++)
      inst.setMatrixAt(n++, m.makeTranslation(i - GRID/2 + .5, STUD_H/2, j - GRID/2 + .5));
  plateGroup.add(inst);

  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(GRID * 0.92, GRID * 0.92, 0.05, 64),
    new THREE.MeshBasicMaterial({ color:'#2c3548' })
  );
  skirt.position.y = -PLATE - 0.03;
  plateGroup.add(skirt);
}

/* ---------- world state ---------- */
const heights = new Int16Array(GRID * GRID);      // stacked height per column, in plates
const placed  = [];                               // { group, def, i0, j0, h0 }
const hitList = [];                               // meshes eligible for raycast
plateGroup.traverse(o => { if (o.isMesh && o.userData.isBase) hitList.push(o); });

const H = (i, j) => heights[j * GRID + i];
const setH = (i, j, v) => { heights[j * GRID + i] = v; };

/* =========================== camera rig =========================== */
const view = { az: -0.7, pol: 0.92, rad: 34, taz: -0.7, tpol: 0.92, trad: 34 };
const HOME = { az: -0.7, pol: 0.92, rad: 34 };
const POL_MIN = 0.30, POL_MAX = 1.40;            // ~17° (top-down-ish) .. ~80° (near horizon)
const RAD_MIN = 12,  RAD_MAX = 56;

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
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* =========================== pointer routing =========================== */
/* Every pointer is independently owned by either the navigator (stage) or a
   drag session (menu). One hand can orbit while the other drags a brick.      */
const nav   = new Map();   // pointerId -> {x,y}
const drags = new Map();   // pointerId -> {def, tile, held, ghost, sol, rot, az0}
let pinch = null;          // {dist, rad, mx, az}
let manualRot = 0;         // optional 90° offset; the plate's angle does the rest
let selected = 0;

/* ---------- navigation (stage) ---------- */
stageEl.addEventListener('pointerdown', e => {
  try { stageEl.setPointerCapture(e.pointerId); } catch {}
  nav.set(e.pointerId, { x:e.clientX, y:e.clientY });
  if (nav.size === 2) startPinch();
});
stageEl.addEventListener('pointermove', e => {
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
});
function endNav(e) {
  if (!nav.delete(e.pointerId)) return;
  pinch = null;
  if (nav.size === 2) startPinch();
}
function startPinch() {
  const [a, b] = [...nav.values()];
  pinch = { dist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), rad: view.trad, mx: (a.x + b.x) / 2, az: view.taz };
}
stageEl.addEventListener('pointerup', endNav);
stageEl.addEventListener('pointercancel', endNav);

/* =========================== placement solving =========================== */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const HOVER = 2.6;                                  // how high a held brick floats
const LIFT  = 1.5;                                  // ...and how far above the fingertip
const hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpV = new THREE.Vector3(), camUp = new THREE.Vector3();

/* aim `ray` at a screen point — false if that point isn't over the 3D stage */
function castFrom(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return true;
}

/* where does the brick currently under `ray` land? null if it misses the build */
function solveRay(def, rot) {
  const hit = ray.intersectObjects(hitList, false)[0];
  if (!hit) return null;

  // nudge into the column we actually hit (side faces sit exactly on a seam)
  const px = hit.point.x - hit.face.normal.x * 0.02;
  const pz = hit.point.z - hit.face.normal.z * 0.02;

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
const solve = (x, y, def, rot) => castFrom(x, y) ? solveRay(def, rot) : null;

const placeX = (i0, w) => i0 - GRID / 2 + w / 2;

/* =========================== drag sessions =========================== */
/* A held brick hangs off your finger in 3D and keeps the orientation it has in
   the air. Spinning the plate underneath turns the grid, not the brick — so it
   lands on whichever grid axis is nearest and you never reach for a button.   */
function gridRot(s) {
  const steps = Math.round((view.az - s.az0) / (Math.PI / 2));
  return (manualRot + steps) & 1;        // a footprint only cares about parity
}

function beginDrag(e, def, srcEl) {
  const tile = document.createElement('div');      // stand-in while over the menu
  tile.className = 'tile';
  tile.appendChild(srcEl.querySelector('.swatch').cloneNode(true));
  document.getElementById('chips').appendChild(tile);
  const s = { def, tile, x:e.clientX, y:e.clientY, az0:view.az,
              held:null, ghost:null, rot:-1, sol:null };
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

  s.tile.style.left = s.x + 'px';
  s.tile.style.top  = s.y + 'px';
  s.tile.style.display = over ? 'none' : 'block';   // 3D takes over on the stage

  const rot = gridRot(s);
  if (rot !== s.rot) {                              // snapped to the other grid axis
    const def = rot ? { ...s.def, w:s.def.d, d:s.def.w } : s.def;
    if (s.held)  scene.remove(s.held);
    if (s.ghost) build.remove(s.ghost);
    s.held  = buildBrick(def);                      // solid — this is the one in your hand
    s.ghost = buildBrick(def, true);                // translucent — this is where it lands
    scene.add(s.held);
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
  }

  s.ghost.visible = !!sol;
  if (!sol) return;
  s.ghost.position.set(placeX(sol.i0, sol.w), sol.h * PLATE, placeX(sol.j0, sol.d));
  const tint = sol.ok ? null : '#ff3b3b';
  s.ghost.traverse(o => { if (o.isMesh) o.material = brickMat(tint || s.def.c, true); });
}
function endDrag(e) {
  const s = drags.get(e.pointerId);
  if (!s) return;
  drags.delete(e.pointerId);
  if (s.ghost) build.remove(s.ghost);
  if (s.held)  scene.remove(s.held);
  s.tile.remove();
  if (s.sol && s.sol.ok) place(s.def, s.sol, s.rot, s.held.visible ? s.held.position : null);
}
function place(def, sol, rot, from) {
  const d2 = rot ? { ...def, w:def.d, d:def.w } : def;
  const g = buildBrick(d2);
  const base = new THREE.Vector3(placeX(sol.i0, sol.w), sol.h * PLATE, placeX(sol.j0, sol.d));
  g.position.copy(base);
  // fall into the socket from wherever the hand released it (`from` is world,
  // `base` is board-local — they differ by however far the board is bouncing)
  const off = from ? from.clone().sub(base) : new THREE.Vector3(0, 0.9, 0);
  if (from) off.y -= build.position.y;
  g.position.add(off);
  build.add(g);
  hitList.push(g.userData.pickBody);
  for (let i = sol.i0; i < sol.i0 + sol.w; i++)
    for (let j = sol.j0; j < sol.j0 + sol.d; j++) setH(i, j, sol.h + def.p);
  const p = { g, def, sol, base, anim: { off, t: 0, v: 0.015 } };
  placed.push(p);
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
function undo() {
  const last = placed.pop();
  if (!last) return;
  build.remove(last.g);
  hitList.splice(hitList.indexOf(last.g.userData.pickBody), 1);
  heights.fill(0);
  for (const p of placed)
    for (let i = p.sol.i0; i < p.sol.i0 + p.sol.w; i++)
      for (let j = p.sol.j0; j < p.sol.j0 + p.sol.d; j++) setH(i, j, p.sol.h + p.def.p);
}

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
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('press');
    selected = idx;
    [...paletteEl.children].forEach((c, i) => c.classList.toggle('active', i === idx));
    beginDrag(e, def, el);
  });
  el.addEventListener('pointermove', e => {
    const s = drags.get(e.pointerId);
    if (s) moveDrag(e, s);
  });
  const up = e => { el.classList.remove('press'); endDrag(e); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
});

const rotStateEl = document.getElementById('rotState');
const tap = (id, fn) => document.getElementById(id)
  .addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
tap('btnRotate', () => { manualRot ^= 1; rotStateEl.textContent = manualRot ? '90°' : '0°'; });
tap('btnUndo', undo);
tap('btnClear', () => { while (placed.length) undo(); });
tap('btnHome', () => { view.taz = HOME.az; view.tpol = HOME.pol; view.trad = HOME.rad; });
tap('btnFull', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') { manualRot ^= 1; rotStateEl.textContent = manualRot ? '90°' : '0°'; }
  if (e.key === 'z' || e.key === 'Z') undo();
});

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

function tick(now) {
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
  renderer.render(scene, camera);
  if (++frames >= 30) {
    statsEl.textContent = `${Math.round(frames * 1000 / (now - fpsT))} fps · ${placed.length} bricks · ${drags.size + nav.size} touches`;
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
window.__kiosk = { placed, heights, view, drags, nav, CATALOG, solve, hitList, camera, scene, build, ray, ndc, THREE, gridRot, popSound, boardY, get manualRot(){ return manualRot; } };
