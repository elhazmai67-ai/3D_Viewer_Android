import * as THREE from 'three';
THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // Z-up (3D printing)
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const $ = s => document.querySelector(s), V3 = THREE.Vector3, V2 = THREE.Vector2, GAP = 20, MAX = 10, fmt = n => n.toFixed(1);
const PAL = [0x4f8cff, 0xff8a4f, 0x5fd38d, 0xe0b84f, 0xb072ff, 0xff6b9a, 0x4fd1d9, 0xa3c84f, 0xd98a8a, 0x8a9bd9];
const SW = [0x19a8d1, 0xee7d2e, 0x4aa564, 0x6c6fd8, 0xd04d73, 0x587087, 0xffffff, 0xd8dce4, 0x9ca7b3, 0x465364, 0x1f2a3a, 0x0f1626, 0xef4444, 0xb91c1c, 0xf97316, 0xf59e0b, 0xfacc15, 0x84cc16, 0x22c55e, 0x15803d, 0x14b8a6, 0x06b6d4, 0x0284c7, 0x2563eb, 0x4f46e5, 0x7c3aed, 0xa855f7, 0xec4899, 0xbe185d, 0x8a5a33];
const MATS = [['PLA', 1.24, 1], ['PETG', 1.27, 1], ['ABS', 1.04, 1], ['Resin', 1.10, 0]]; // name, g/cm3, uses infill
const PRESETS = [['Matte Plastic', { r: .85, m: 0 }, 0], ['PLA', { r: .55, m: .05 }, 0], ['PETG', { r: .25, m: .05, o: .85 }, 1], ['ABS', { r: .4, m: .05 }, 2], ['Resin', { r: .2, m: 0, o: .8 }, 3],
  ['Satin Metal', { r: .4, m: 1 }], ['Brushed Metal', { r: .55, m: 1 }], ['Chrome', { r: .05, m: 1 }], ['Glass', { r: .02, m: 0, o: .3 }],
  ['Inspection Gray', { r: .9, m: 0, c: 0xa0a6ad }], ['Clay', { r: 1, m: 0, c: 0xb08968 }], ['X-Ray', { r: .5, m: 0, o: .25 }]];
const AXV = { x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, 1) }, COL = { x: 0xff4d4d, y: 0x4dd96a, z: 0x4d8cff }, LB = { x: 'W', y: 'D', z: 'H' };

const canvas = $('#c'), view = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0f1115);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000), gcam = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.12;
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, .5));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(300, -400, 600); scene.add(sun);
const grid = new THREE.GridHelper(600, 30, 0x3a4250, 0x232832); grid.rotation.x = Math.PI / 2; scene.add(grid);

let models = [], mode = 'scene', tool = 'scale', selId = null, base = 300, uid = 0, snapV = 0, dirty = true, drag = null, gzOn = false, tw = null, undo = [], redo = [], saveT = null, restoring = false;
const gC = new V3(); let gR = 1;
const sel = () => models.find(x => x.id === selId), sn = v => (snapV ? Math.round(v / snapV) * snapV : v), T = new V3();
const toast = t => { const e = $('#toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(toast.t); toast.t = setTimeout(() => (e.style.opacity = 0), 1900); };

// ---------- storage (IndexedDB): autosave + projects ----------
const dbp = new Promise(r => { try { const q = indexedDB.open('v3d2', 1); q.onupgradeneeded = () => q.result.createObjectStore('p', { keyPath: 'id' }); q.onsuccess = () => r(q.result); q.onerror = () => r(null); } catch (e) { r(null); } });
const tx = async (md, f) => { const d = await dbp; if (!d) return; return new Promise(r => { try { const q = f(d.transaction('p', md).objectStore('p')); q.onsuccess = () => r(q.result); q.onerror = () => r(); } catch (e) { r(); } }); };
const items = () => models.map(m => ({ name: m.name, data: m.buf, sc: m.sc.toArray(), q: m.q.toArray(), pos: m.pos.toArray(), color: m.color, preset: m.preset, mat: m.mat, visible: m.visible, styled: m.styled }));
const putProject = (id, name) => tx('readwrite', s => s.put({ id, name, t: Date.now(), n: models.length, items: items() }));
function setAS(t) { $('#as').textContent = t; }
function changed() {
  dirty = true; if (restoring) return; setAS('Autosaving… ⟳'); clearTimeout(saveT);
  saveT = setTimeout(async () => { await putProject('autosave', 'Autosave'); setAS('Autosaved locally ✓'); renderRecent(); }, 1200);
}
async function renderRecent() {
  const all = ((await tx('readonly', s => s.getAll())) || []).sort((a, b) => b.t - a.t), R = $('#recent'); R.innerHTML = '';
  if (!all.length) R.innerHTML = '<div class="rr"><small>Abhi koi project nahi</small></div>';
  all.forEach(p => {
    const r = document.createElement('div'); r.className = 'rr'; r.innerHTML = '<div><span></span><small></small></div><button>✕</button>';
    r.querySelector('span').textContent = p.name; r.querySelector('small').textContent = p.n + ' object' + (p.n === 1 ? '' : 's') + ' · ' + new Date(p.t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    r.onclick = () => { closeMenu(); openItems(p.items, p.name); };
    r.querySelector('button').onclick = async e => { e.stopPropagation(); await tx('readwrite', s => s.delete(p.id)); renderRecent(); };
    R.appendChild(r);
  });
}
const toB64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
async function saveBlob(name, blob) {
  try {
    if (Capacitor.isNativePlatform()) {
      const b64 = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(blob); });
      const r = await Filesystem.writeFile({ path: name, data: b64, directory: Directory.Cache }); await Share.share({ title: name, url: r.uri });
    } else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  } catch (e) { if (!/cancel/i.test(e.message || '')) toast('Save error: ' + e.message); }
}

// ---------- geometry ----------
function tris(root, cb) {
  root.updateMatrixWorld(true); let n = 0; const a = new V3(), b = new V3(), c = new V3();
  root.traverse(m => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position, ix = m.geometry.index, cnt = ix ? ix.count : p.count, f = (i, k) => (ix ? ix.getX(i + k) : i + k);
    for (let i = 0; i + 2 < cnt; i += 3) {
      a.fromBufferAttribute(p, f(i, 0)).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, f(i, 1)).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(p, f(i, 2)).applyMatrix4(m.matrixWorld);
      cb(a, b, c); n++;
    }
  });
  return n;
}
const curVol = m => m.vol0 * m.sc.x * m.sc.y * m.sc.z;
function settle(m) { // recentre on bed after rotation / load
  const h = m.holder, s = h.scale.clone(), p = h.position.clone();
  h.scale.set(1, 1, 1); h.position.set(0, 0, 0); m.obj.quaternion.copy(m.q); m.obj.position.set(0, 0, 0); h.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(h, true), c = b.getCenter(new V3());
  m.obj.position.set(-c.x, -c.y, -b.min.z); b.getSize(m.base);
  h.scale.copy(s); h.position.copy(p); m.size.copy(m.base).multiply(m.sc); h.updateMatrixWorld(true);
}
function applyLook(m) {
  const P = PRESETS[m.preset][1]; m.styled = true;
  m.holder.traverse(o => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => x && x.dispose && x.dispose());
    o.material = new THREE.MeshStandardMaterial({ color: m.color, roughness: P.r, metalness: P.m, transparent: (P.o ?? 1) < 1, opacity: P.o ?? 1, depthWrite: (P.o ?? 1) >= 1, side: THREE.DoubleSide });
  });
  dirty = true;
}
async function parse(name, buf) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'stl') { const g = new STLLoader().parse(buf); g.computeVertexNormals(); return new THREE.Mesh(g, new THREE.MeshStandardMaterial()); }
  if (ext === '3mf') return new ThreeMFLoader().parse(buf);
  if (ext === 'obj') return new OBJLoader().parse(new TextDecoder().decode(buf));
  if (ext === 'glb' || ext === 'gltf') return new Promise((ok, no) => new GLTFLoader().parse(buf, '', g => ok(g.scene), no));
  return null;
}
async function addModel(name, buf, o = {}) {
  const obj = await parse(name, buf); if (!obj) { toast('Format support nahi: ' + name); return null; }
  const holder = new THREE.Group(); holder.add(obj);
  const m = { id: ++uid, name, buf, obj, holder, base: new V3(), size: new V3(), sc: new V3(1, 1, 1), q: new THREE.Quaternion(), pos: new V3(), vol0: 0, tris: 0, visible: o.visible !== false,
    color: o.color ?? PAL[models.length % PAL.length], preset: o.preset ?? 1, mat: o.mat ?? 0, styled: o.styled ?? /\.stl$/i.test(name), status: '', pop: 0 };
  if (o.sc) m.sc.fromArray(o.sc); if (o.q) m.q.fromArray(o.q); if (o.pos) m.pos.fromArray(o.pos);
  let v = 0; m.tris = tris(holder, (a, b, c) => { v += a.dot(T.copy(b).cross(c)) / 6; }); m.vol0 = Math.abs(v) / 1000;
  if (m.styled) applyLook(m);
  settle(m); holder.scale.copy(m.sc).multiplyScalar(0.02);
  if (!o.pos) { const ot = models; m.pos.set(ot.length ? Math.max(...ot.map(x => x.pos.x + x.size.x / 2)) + GAP + m.size.x / 2 : 0, 0, 0); }
  scene.add(holder); models.push(m); selId = m.id; return m;
}
async function loadItems(list) {
  for (const it of list) { if (models.length >= MAX) break; await addModel(it.name, it.data, { sc: it.sc, q: it.q, pos: it.pos, color: it.color, preset: it.preset, mat: it.mat, visible: it.visible, styled: it.styled }); }
}
function clearAll() { models.forEach(m => { scene.remove(m.holder); m.holder.traverse(o => o.geometry && o.geometry.dispose()); }); models = []; selId = null; undo = []; redo = []; }
async function openItems(list, name) { restoring = true; clearAll(); await loadItems(list); restoring = false; refresh(true); changed(); toast((name || 'Project') + ' khul gaya'); }
async function handleFiles(files) {
  for (const f of files) {
    const ext = f.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'json') { const j = JSON.parse(await f.text()); await openItems(j.items.map(i => ({ ...i, data: fromB64(i.data) })), f.name.replace(/\.v3d\.json$/, '')); continue; }
      if (ext === 'zip') {
        const z = unzipSync(new Uint8Array(await f.arrayBuffer()));
        for (const [n, u] of Object.entries(z)) { if (models.length >= MAX) break; if (/\.(stl|3mf|glb|gltf|obj)$/i.test(n)) await addModel(n.split('/').pop(), u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); }
        continue;
      }
      if (models.length >= MAX) { toast('Max ' + MAX + ' files'); break; }
      await addModel(f.name, await f.arrayBuffer());
    } catch (e) { toast(f.name + ': ' + e.message); }
  }
  refresh(true); changed();
}
function removeModel(m) {
  if (!m) return; scene.remove(m.holder); m.holder.traverse(o => o.geometry && o.geometry.dispose());
  models = models.filter(x => x !== m); if (selId === m.id) selId = models.length ? models[models.length - 1].id : null; refresh(true); changed();
}
async function dup(m) {
  if (!m) return; if (models.length >= MAX) return toast('Max ' + MAX + ' files');
  const n = await addModel(m.name, m.buf, { sc: m.sc.toArray(), q: m.q.toArray(), color: m.color, preset: m.preset, mat: m.mat, styled: m.styled, pos: [m.pos.x + m.size.x + GAP, m.pos.y, m.pos.z] });
  if (n) { refresh(true); changed(); }
}
function checkMesh(m) {
  let open = 0, nm = 0;
  m.holder.traverse(o => {
    if (!o.isMesh) return; const g = o.geometry, p = g.attributes.position, ix = g.index, n = ix ? ix.count : p.count, ids = new Map(), E = new Map();
    const id = i => { const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3); let v = ids.get(k); if (v === undefined) { v = ids.size; ids.set(k, v); } return v; };
    for (let i = 0; i + 2 < n; i += 3) {
      const a = id(ix ? ix.getX(i) : i), b = id(ix ? ix.getX(i + 1) : i + 1), c = id(ix ? ix.getX(i + 2) : i + 2);
      [[a, b], [b, c], [c, a]].forEach(([u, v]) => { const k = u < v ? u + '_' + v : v + '_' + u; E.set(k, (E.get(k) || 0) + 1); });
    }
    E.forEach(c => { if (c === 1) open++; else if (c > 2) nm++; });
  });
  m.status = open || nm ? open + ' open edges' + (nm ? ', ' + nm + ' non-manifold' : '') : 'Watertight ✓';
}

// ---------- export ----------
const exGroup = (list, zero) => { const g = new THREE.Group(); list.forEach(m => { const c = m.holder.clone(); if (zero) c.position.set(0, 0, 0); g.add(c); }); g.updateMatrixWorld(true); return g; };
function stlBlob(g) {
  const L = []; tris(g, (a, b, c) => L.push(a.toArray(), b.toArray(), c.toArray()));
  const buf = new ArrayBuffer(84 + 50 * (L.length / 3)), dv = new DataView(buf); dv.setUint32(80, L.length / 3, true);
  const A = new V3(), B = new V3(), C = new V3();
  for (let i = 0; i < L.length; i += 3) {
    A.fromArray(L[i]); B.fromArray(L[i + 1]); C.fromArray(L[i + 2]);
    const nr = B.clone().sub(A).cross(C.clone().sub(A)).normalize(), o = 84 + (i / 3) * 50;
    [nr.toArray(), L[i], L[i + 1], L[i + 2]].flat().forEach((v, k) => dv.setFloat32(o + k * 4, v, true));
  }
  return new Blob([buf]);
}
async function doExport(fmt3, onlySel) {
  const m = sel(), list = onlySel ? (m ? [m] : []) : models.filter(x => x.visible); if (!list.length) return toast('Export ke liye koi model nahi');
  const g = exGroup(list, onlySel), nm = (onlySel ? m.name.replace(/\.\w+$/, '') + '_' + m.size.toArray().map(v => Math.round(v)).join('x') : 'workspace');
  let blob; toast('Export ho raha hai…');
  if (fmt3 === 'stl') blob = stlBlob(g);
  else if (fmt3 === 'obj') blob = new Blob([new OBJExporter().parse(g)]);
  else blob = new Blob([await new Promise((ok, no) => new GLTFExporter().parse(g, ok, no, { binary: true }))]);
  await saveBlob(nm + '.' + fmt3, blob);
}

// ---------- layout / camera / undo ----------
function layout() {
  models.forEach(m => { m.holder.visible = m.visible; if (mode === 'scene') m.holder.position.copy(m.pos); else m.holder.position.set(0, 0, 0); });
}
function arrange() {
  const vis = models.filter(m => m.visible); let x = -(vis.reduce((s, m) => s + m.size.x, 0) + GAP * (vis.length - 1)) / 2;
  for (const m of vis) { m.pos.set(x + m.size.x / 2, 0, 0); x += m.size.x + GAP; }
}
function animTo(pos, tar, dur = 380) { tw = { t0: performance.now(), dur, p0: camera.position.clone(), p1: pos, a0: controls.target.clone(), a1: tar }; dirty = true; }
function stepTw(now) {
  if (!tw) return; const k = Math.min(1, (now - tw.t0) / tw.dur), e = 1 - Math.pow(1 - k, 3);
  camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.a0, tw.a1, e); if (k >= 1) tw = null; dirty = true;
}
function fit(anim) {
  const vis = models.filter(m => m.visible); if (!vis.length) return;
  const box = new THREE.Box3(); vis.forEach(m => box.expandByPoint(new V3(m.pos.x - m.size.x / 2, m.pos.y - m.size.y / 2, 0)).expandByPoint(new V3(m.pos.x + m.size.x / 2, m.pos.y + m.size.y / 2, m.pos.z + m.size.z)));
  const c = box.getCenter(new V3()), s = box.getSize(new V3()), r = Math.max(s.x, s.y, s.z) || 100;
  base = r * 2.2; camera.near = r / 100; camera.far = r * 100; camera.updateProjectionMatrix();
  const p = c.clone().addScaledVector(new V3(1, -1.2, .9).normalize(), base);
  if (anim) animTo(p, c); else { controls.target.copy(c); camera.position.copy(p); controls.update(); } dirty = true;
}
function setView(d) { const c = controls.target, dist = camera.position.distanceTo(c); animTo(c.clone().addScaledVector(d.clone().normalize(), dist), c.clone(), 320); }
const stateOf = () => models.map(m => ({ id: m.id, name: m.name, sc: m.sc.toArray(), q: m.q.toArray(), pos: m.pos.toArray(), color: m.color, preset: m.preset, mat: m.mat, visible: m.visible }));
function pushUndo() { const s = stateOf(); if (undo.length && JSON.stringify(undo[undo.length - 1]) === JSON.stringify(s)) return; undo.push(s); if (undo.length > 60) undo.shift(); redo = []; }
function restore(s) {
  s.forEach(o => { const m = models.find(x => x.id === o.id); if (!m) return; Object.assign(m, { name: o.name, color: o.color, preset: o.preset, mat: o.mat, visible: o.visible }); m.sc.fromArray(o.sc); m.q.fromArray(o.q); m.pos.fromArray(o.pos); m.pop = 1; m.holder.scale.copy(m.sc); settle(m); if (m.styled) applyLook(m); });
  refresh(); changed();
}
const doUndo = () => { if (!undo.length) return toast('Undo ke liye kuch nahi'); redo.push(stateOf()); restore(undo.pop()); };
const doRedo = () => { if (!redo.length) return toast('Redo ke liye kuch nahi'); undo.push(stateOf()); restore(redo.pop()); };

// ---------- UI ----------
function upd(m, list) { layout(); renderInfo(); if (list) renderList(); labels(); changed(); }
function applyScale(m) { m.pop = 1; m.holder.scale.copy(m.sc); m.size.copy(m.base).multiply(m.sc); upd(m, true); }
function setSize(m, ax, v, snap) {
  if (snap) v = sn(v); if (!(v > 0)) return; const k = Math.max(v, .1) / m.base[ax];
  if ($('#lock').checked) m.sc.set(k, k, k); else m.sc[ax] = k; applyScale(m);
}
function select(id) { selId = id; renderList(); renderInfo(); dirty = true; }
function labels() {
  const L = $('#labels'); L.innerHTML = ''; const vis = models.filter(m => m.visible); if (mode !== 'grid' || vis.length < 2) return;
  const cols = Math.ceil(Math.sqrt(vis.length)), rows = Math.ceil(vis.length / cols);
  vis.forEach((m, i) => { const d = document.createElement('div'); d.textContent = m.name; Object.assign(d.style, { left: (i % cols) * 100 / cols + '%', top: Math.floor(i / cols) * 100 / rows + '%', width: 100 / cols + '%', height: 100 / rows + '%' }); L.appendChild(d); });
}
function renderList() {
  const A = $('#list'); A.innerHTML = '';
  models.forEach(m => {
    const r = document.createElement('div'); r.className = 'row' + (m.id === selId ? ' sel' : '');
    r.innerHTML = '<input type="checkbox"' + (m.visible ? ' checked' : '') + '><div class="nm"><span></span><small></small></div><button>⧉</button><button>🗑</button>';
    r.querySelector('span').textContent = m.name;
    r.querySelector('small').textContent = m.size.toArray().map(fmt).join(' × ') + ' mm' + (m.sc.x === 1 && m.sc.y === 1 && m.sc.z === 1 ? '' : ' (' + Math.round(m.sc.x * 100) + '%)');
    r.querySelector('input').onclick = e => { e.stopPropagation(); pushUndo(); m.visible = e.target.checked; refresh(); changed(); };
    const [b1, b2] = r.querySelectorAll('button'); b1.onclick = e => { e.stopPropagation(); dup(m); }; b2.onclick = e => { e.stopPropagation(); removeModel(m); };
    r.onclick = () => select(m.id); A.appendChild(r);
  });
}
function renderInfo() {
  const m = sel(), inf = +$('#inf').value, vis = models.filter(x => x.visible);
  $('#p-sel').querySelectorAll('input,button').forEach(e => (e.disabled = !m));
  const vol = m ? curVol(m) : 0, tv = vis.reduce((a, x) => a + curVol(x), 0), wt = (v, i) => v * MATS[i][1] * (MATS[i][2] ? .2 + .8 * inf / 100 : 1);
  $('#pDel').style.display = m ? '' : 'none'; $('#hint').style.display = models.length ? 'none' : '';
  $('#cards').innerHTML = [['Visible', vis.length], ['Volume', m ? fmt(vol * 1000) + ' mm³' : '—'], ['Selected weight', m ? fmt(wt(vol, m.mat)) + ' g ' + MATS[m.mat][0] : '—'], ['Status', m ? (m.status || 'Not checked') : '—']].map(([a, b]) => '<div class="card"><small>' + a + '</small><b>' + b + '</b></div>').join('');
  $('#mt').innerHTML = '<tr><th></th><th>Selected</th><th>All (' + vis.length + ')</th></tr>' + MATS.map((x, i) => '<tr><td>' + x[0] + (x[2] ? '' : ' (solid)') + '</td><td>' + fmt(wt(vol, i)) + ' g</td><td>' + fmt(wt(tv, i)) + ' g</td></tr>').join('');
  [...$('#pre').children].forEach((b, i) => b.classList.toggle('on', !!m && m.styled && m.preset === i));
  [...$('#sws').children].forEach((b, i) => b.classList.toggle('on', !!m && m.styled && m.color === SW[i]));
  document.querySelectorAll('[data-x$="-s"]').forEach(b => (b.disabled = !m));
  if (!m) { $('#nmT').textContent = 'Koi model select nahi'; $('#szT').textContent = ''; return; }
  $('#nmT').textContent = m.name; $('#szT').textContent = m.size.toArray().map(v => +v.toFixed(2) + ' mm').join(' x ');
  const set = (id, v) => { const el = $('#' + id); if (document.activeElement !== el) el.value = v; };
  const e = new THREE.Euler().setFromQuaternion(m.q, 'XYZ');
  set('nmI', m.name); set('iW', +m.size.x.toFixed(2)); set('iD', +m.size.y.toFixed(2)); set('iH', +m.size.z.toFixed(2)); set('iP', Math.round(m.sc.x * 100));
  [['sW', 'x'], ['sD', 'y'], ['sH', 'z']].forEach(([id, ax]) => { const el = $('#' + id); if (document.activeElement !== el) { el.max = Math.max(m.base[ax] * 5, 10); el.value = m.size[ax]; } });
  set('pX', +m.pos.x.toFixed(2)); set('pY', +m.pos.y.toFixed(2)); set('pZ', +m.pos.z.toFixed(2));
  set('rX', +(e.x * 180 / Math.PI).toFixed(1)); set('rY', +(e.y * 180 / Math.PI).toFixed(1)); set('rZ', +(e.z * 180 / Math.PI).toFixed(1));
}
function refresh(refit) { layout(); renderList(); renderInfo(); labels(); if (refit) fit(true); dirty = true; }
function tab(t) { document.querySelectorAll('#sheet section').forEach(s => (s.hidden = s.id !== 'p-' + t)); document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); }
const closeMenu = () => $('#menu').classList.add('closed');
const resize = () => { renderer.setSize(view.clientWidth, view.clientHeight, false); dirty = true; };
new ResizeObserver(resize).observe(view); resize();

// ---------- gizmos: Move (arrows) / Rotate (rings) / Scale (cube handles + mm labels) ----------
const gz = new THREE.Group(); gz.visible = false; scene.add(gz);
const BM = c => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true });
function mkAx(ax, head) {
  const g = new THREE.Group(), mt = BM(COL[ax]);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, .5, 0), mt);
  const hd = new THREE.Mesh(head === 'box' ? new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0) : new THREE.ConeGeometry(1, 1, 12).translate(0, .5, 0), mt);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
  sh.renderOrder = hd.renderOrder = 999; g.add(sh, hd, hit);
  if (ax === 'x') g.rotation.z = -Math.PI / 2; if (ax === 'z') g.rotation.x = Math.PI / 2; gz.add(g);
  return { ax, g, sh, hd, hit, head, tip: new V3(), d: AXV[ax], org: new V3(), len: 1 };
}
function setAx(a, org, len, r, dist) {
  const hl = a.head === 'box' ? r * 4 : r * 7, hw = a.head === 'box' ? r * 4 : r * 2.8, sl = Math.max(len - hl, .01);
  a.g.position.copy(org); a.sh.scale.set(r, sl, r); a.hd.scale.set(hw, hl, hw); a.hd.position.y = sl;
  a.hit.position.y = len; a.hit.scale.setScalar(dist * .035); a.tip.copy(org).addScaledVector(a.d, len); a.org.copy(org); a.len = len; a.g.visible = true;
}
function mkRing(ax) {
  const g = new THREE.Group(), ring = new THREE.Mesh(new THREE.TorusGeometry(1, .012, 8, 80), BM(COL[ax])); ring.renderOrder = 999;
  const hit = new THREE.Mesh(new THREE.TorusGeometry(1, .08, 8, 48), new THREE.MeshBasicMaterial({ visible: false })); g.add(ring, hit);
  if (ax === 'x') g.rotation.y = Math.PI / 2; if (ax === 'y') g.rotation.x = Math.PI / 2; gz.add(g); return { ax, g, hit, d: AXV[ax] };
}
const scalers = ['x', 'y', 'z'].map(a => mkAx(a, 'box')), movers = ['x', 'y', 'z'].map(a => mkAx(a, 'cone')), rings = ['x', 'y', 'z'].map(mkRing);
scalers.forEach(a => { a.el = document.createElement('div'); a.el.className = 'al'; a.el.style.background = '#' + COL[a.ax].toString(16); $('#alab').appendChild(a.el); });
function updG(sm, show) {
  const on = show && !!sm && !!tool; gz.visible = on; gzOn = on;
  [...scalers, ...movers, ...rings].forEach(x => (x.g.visible = false)); scalers.forEach(a => (a.el.style.display = 'none'));
  $('#rhud').style.display = on && tool === 'rotate' ? 'flex' : 'none'; if (!on) return;
  const P = sm.holder.position, s = sm.size, c = new V3(P.x, P.y, P.z + s.z / 2), dist = camera.position.distanceTo(c), r = dist * .004, mx = Math.max(s.x, s.y, s.z), W = view.clientWidth, H = view.clientHeight;
  gC.copy(c);
  if (tool === 'scale') {
    const mn = new V3(P.x - s.x / 2, P.y - s.y / 2, P.z);
    scalers.forEach(a => {
      setAx(a, mn, s[a.ax], r, dist); const p = a.tip.clone().project(camera);
      a.el.textContent = LB[a.ax] + ' ' + fmt(s[a.ax]) + ' mm'; a.el.style.transform = 'translate(' + (p.x * .5 + .5) * W + 'px,' + (-p.y * .5 + .5) * H + 'px)'; a.el.style.display = p.z < 1 ? '' : 'none';
    });
  } else if (tool === 'move') movers.forEach(a => setAx(a, c, mx * .75 + dist * .08, r, dist));
  else {
    gR = mx * .7 + dist * .03; rings.forEach(a => { a.g.visible = true; a.g.position.copy(c); a.g.scale.setScalar(gR); });
    const e = new THREE.Euler().setFromQuaternion(sm.q, 'XYZ'), d = v => fmt(v * 180 / Math.PI) + '°';
    $('#hX').textContent = 'X ' + d(e.x); $('#hY').textContent = 'Y ' + d(e.y); $('#hZ').textContent = 'Z ' + d(e.z);
  }
}
const ray = new THREE.Raycaster();
const toNdc = e => { const r = canvas.getBoundingClientRect(); return [new V2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), r]; };
const sv = (a, b, r) => new V2((b.x - a.x) * r.width / 2, -(b.y - a.y) * r.height / 2);
view.addEventListener('pointerdown', e => {
  if (!gzOn || e.target !== canvas) return; const m = sel(); if (!m) return;
  const [nd, r] = toNdc(e); ray.setFromCamera(nd, camera);
  const list = tool === 'rotate' ? rings : tool === 'move' ? movers : scalers, h = ray.intersectObjects(list.map(x => x.hit), false)[0]; if (!h) return;
  const it = list.find(x => x.hit === h.object); e.stopPropagation(); e.preventDefault(); pushUndo();
  const base0 = { m, it, x0: e.clientX, y0: e.clientY };
  if (tool === 'rotate') {
    const A = it.d.clone(), rad = h.point.clone().sub(gC); rad.addScaledVector(A, -rad.dot(A)).normalize();
    const tg = new V3().crossVectors(A, rad), step = gR * .2, v = sv(h.point.clone().project(camera), h.point.clone().addScaledVector(tg, step).project(camera), r);
    drag = { ...base0, kind: 'rot', A, qs: m.q.clone(), u: v.clone().normalize(), k: step / Math.max(v.length(), .5) / gR };
  } else {
    const v = sv(it.org.clone().project(camera), it.tip.clone().project(camera), r), pxmm = Math.max(v.length(), 1) / it.len;
    drag = { ...base0, kind: tool, u: v.clone().normalize(), pxmm, s0: tool === 'scale' ? m.size[it.ax] : m.pos[it.ax] };
  }
}, true);
window.addEventListener('pointermove', e => {
  if (!drag) return; const d = drag, m = d.m, px = (e.clientX - d.x0) * d.u.x + (e.clientY - d.y0) * d.u.y;
  if (d.kind === 'scale') setSize(m, d.it.ax, d.s0 + (d.it.ax === 'z' ? 1 : 2) * px / d.pxmm, true);
  else if (d.kind === 'move') { m.pos[d.it.ax] = sn(d.s0 + px / d.pxmm); upd(m); }
  else { m.q.copy(d.qs).premultiply(new THREE.Quaternion().setFromAxisAngle(d.A, px * d.k)); settle(m); upd(m); }
  dirty = true;
});
window.addEventListener('pointerup', () => { if (drag) { drag = null; renderList(); renderInfo(); } });
window.addEventListener('pointercancel', () => (drag = null));

// ---------- render loop (draws only when something changes = smooth + battery friendly) ----------
function draw() {
  const W = view.clientWidth, H = view.clientHeight, vis = models.filter(m => m.visible), grd = mode === 'grid' && vis.length > 1;
  updG(vis.find(m => m.id === selId), !grd);
  if (grd) {
    const cols = Math.ceil(Math.sqrt(vis.length)), rows = Math.ceil(vis.length / cols), cw = W / cols, ch = H / rows;
    const dir = camera.position.clone().sub(controls.target).normalize(), zoom = camera.position.distanceTo(controls.target) / base;
    renderer.setScissorTest(true);
    vis.forEach((m, i) => {
      const x = (i % cols) * cw, y = H - (Math.floor(i / cols) + 1) * ch;
      models.forEach(o => (o.holder.visible = o === m)); renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch);
      const r = Math.max(m.size.x, m.size.y, m.size.z) || 1, ctr = new V3(0, 0, m.size.z / 2);
      gcam.aspect = cw / ch; gcam.near = r / 100; gcam.far = r * 100; gcam.position.copy(ctr).addScaledVector(dir, r * 2.2 * zoom); gcam.lookAt(ctr); gcam.updateProjectionMatrix();
      renderer.render(scene, gcam);
    });
    models.forEach(o => (o.holder.visible = o.visible));
  } else { renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.render(scene, camera); }
}
function frame(now) {
  requestAnimationFrame(frame); stepTw(now); let pop = false;
  models.forEach(m => { if (m.pop < 1) { m.pop = Math.min(1, m.pop + .07); m.holder.scale.copy(m.sc).multiplyScalar(Math.max(1 - Math.pow(1 - m.pop, 3), .02)); pop = true; } });
  const ch = controls.update(); if (!(ch || dirty || pop || drag)) return; dirty = false; draw();
}

// ---------- events ----------
$('#file').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };
$('#fileP').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };
$('#bFile').onclick = e => { e.stopPropagation(); $('#menu').classList.toggle('closed'); renderRecent(); };
document.addEventListener('pointerdown', e => { if (!e.target.closest('#menu') && !e.target.closest('#bFile')) closeMenu(); });
$('#mImp').onclick = () => { closeMenu(); $('#file').click(); };
$('#mOpen').onclick = () => { closeMenu(); $('#fileP').click(); };
$('#mNew').onclick = () => { closeMenu(); if (models.length && !confirm('Naya workspace? Abhi ke models hat jayenge (Recent projects me autosave rahega).')) return; putProject('prev', 'Pichla workspace').then(() => { clearAll(); refresh(); changed(); renderRecent(); }); };
$('#mSaveP').onclick = async () => { closeMenu(); if (!models.length) return toast('Save karne ke liye model nahi'); const n = prompt('Project ka naam', 'Project ' + new Date().toLocaleDateString()); if (!n) return; await putProject('p' + Date.now(), n); renderRecent(); toast('Project save ho gaya'); };
$('#mSave').onclick = async () => { closeMenu(); if (!models.length) return toast('Save karne ke liye model nahi'); const o = { v: 1, items: items().map(i => ({ ...i, data: toB64(i.data) })) }; await saveBlob('workspace.v3d.json', new Blob([JSON.stringify(o)])); };
$('#mShare').onclick = () => { closeMenu(); doExport('stl', false); };
document.querySelectorAll('[data-x]').forEach(b => (b.onclick = () => { closeMenu(); const [f, w] = b.dataset.x.split('-'); doExport(f, w === 's'); }));
$('#bExpT').onclick = () => doExport('stl', false);
$('#bUndo').onclick = doUndo; $('#bRedo').onclick = doRedo; $('#bDup').onclick = () => dup(sel());
$('#bDel').onclick = $('#pDel').onclick = () => { const m = sel(); if (m) removeModel(m); };
document.querySelectorAll('[data-tool]').forEach(b => (b.onclick = () => { tool = tool === b.dataset.tool ? null : b.dataset.tool; document.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('on', x.dataset.tool === tool)); dirty = true; }));
$('#bMode').onclick = () => { mode = mode === 'scene' ? 'grid' : 'scene'; toast(mode === 'grid' ? 'Grid mode' : 'Scene mode'); refresh(true); };
$('#bArr').onclick = () => { pushUndo(); arrange(); refresh(true); changed(); };
$('#bFit').onclick = () => fit(true);
$('#bLock').onclick = () => { controls.enabled = !controls.enabled; $('#bLock').textContent = controls.enabled ? '🔓' : '🔒'; toast(controls.enabled ? 'View unlock' : 'View lock'); };
$('#snap').onchange = e => (snapV = +e.target.value);
document.querySelectorAll('[data-v]').forEach(b => (b.onclick = () => setView({ iso: new V3(1, -1.2, .9), x: new V3(1, 0, 0), y: new V3(0, -1, 0), z: new V3(0, -.001, 1) }[b.dataset.v])));
$('#pHide').onclick = () => { const h = $('#sheet').classList.toggle('hide'); document.body.classList.toggle('nopanel', h); $('#pHide').textContent = (h ? '⌃' : '⌄') + ' Panels'; };
$('#tabs').onclick = e => { if (e.target.dataset.t) tab(e.target.dataset.t); };
$('#inf').oninput = () => { $('#infv').textContent = $('#inf').value + '%'; renderInfo(); };
$('#chkS').onclick = () => { const m = sel(); if (m) { checkMesh(m); renderInfo(); toast(m.status); } };
$('#chkV').onclick = () => { const v = models.filter(x => x.visible); v.forEach(checkMesh); renderInfo(); toast(v.filter(x => x.status.startsWith('Water')).length + '/' + v.length + ' watertight'); };
$('#p-sel').addEventListener('focusin', pushUndo);
$('#p-sel').querySelectorAll('input[type=range]').forEach(r => r.addEventListener('pointerdown', pushUndo));
$('#nmI').oninput = e => { const m = sel(); if (m) { m.name = e.target.value; $('#nmT').textContent = m.name; renderList(); changed(); } };
[['iW', 'x'], ['iD', 'y'], ['iH', 'z']].forEach(([id, ax]) => ($('#' + id).oninput = e => { const m = sel(); if (m && e.target.value !== '') setSize(m, ax, +e.target.value); }));
[['sW', 'x'], ['sD', 'y'], ['sH', 'z']].forEach(([id, ax]) => ($('#' + id).oninput = e => { const m = sel(); if (m) setSize(m, ax, +e.target.value, true); }));
$('#iP').oninput = e => { const m = sel(), v = +e.target.value; if (m && v > 0) { m.sc.set(v / 100, v / 100, v / 100); applyScale(m); } };
$('#rst').onclick = () => { const m = sel(); if (m) { pushUndo(); m.sc.set(1, 1, 1); applyScale(m); } };
[['pX', 'x'], ['pY', 'y'], ['pZ', 'z']].forEach(([id, ax]) => ($('#' + id).oninput = e => { const m = sel(); if (m && e.target.value !== '') { m.pos[ax] = +e.target.value; upd(m); } }));
['rX', 'rY', 'rZ'].forEach(id => ($('#' + id).oninput = () => { const m = sel(); if (!m) return; m.q.setFromEuler(new THREE.Euler(...['rX', 'rY', 'rZ'].map(i => (+$('#' + i).value || 0) * Math.PI / 180))); settle(m); upd(m, true); }));
PRESETS.forEach((p, i) => { const b = document.createElement('button'); b.textContent = p[0]; b.onclick = () => { const m = sel(); if (!m) return; pushUndo(); m.preset = i; if (p[1].c) m.color = p[1].c; if (p[2] !== undefined) m.mat = p[2]; applyLook(m); renderInfo(); changed(); }; $('#pre').appendChild(b); });
SW.forEach(c => { const b = document.createElement('button'); b.style.background = '#' + c.toString(16).padStart(6, '0'); b.onclick = () => { const m = sel(); if (!m) return; pushUndo(); m.color = c; applyLook(m); renderInfo(); changed(); }; $('#sws').appendChild(b); });
canvas.addEventListener('pointerdown', e => (pd = [e.clientX, e.clientY])); let pd = null;
canvas.addEventListener('pointerup', e => {
  if (!pd || Math.hypot(e.clientX - pd[0], e.clientY - pd[1]) > 5) return; pd = null;
  const vis = models.filter(m => m.visible); if (!vis.length) return; const [nd, r] = toNdc(e);
  if (mode === 'grid' && vis.length > 1) {
    const cols = Math.ceil(Math.sqrt(vis.length)), rows = Math.ceil(vis.length / cols);
    const t = vis[Math.floor((e.clientY - r.top) / (r.height / rows)) * cols + Math.floor((e.clientX - r.left) / (r.width / cols))]; if (t) select(t.id); return;
  }
  ray.setFromCamera(nd, camera); const hit = ray.intersectObjects(vis.map(m => m.holder), true)[0]; if (!hit) return;
  const t = vis.find(m => { let o = hit.object; while (o) { if (o === m.holder) return true; o = o.parent; } return false; }); if (t) select(t.id);
});
view.ondragover = e => e.preventDefault();
view.ondrop = e => { e.preventDefault(); handleFiles([...e.dataTransfer.files]); };

tab('sel'); refresh(); renderRecent(); requestAnimationFrame(frame);
(async () => { const a = await tx('readonly', s => s.get('autosave')); if (a && a.items && a.items.length) { restoring = true; await loadItems(a.items); restoring = false; refresh(true); toast('Pichla workspace wapas aa gaya'); } })();
