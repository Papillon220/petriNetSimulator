'use strict';

const VERSION = 'V1.2'; // Programmversion (Kopfzeile und Demo-Banner werden beim Start daraus gesetzt)
const NS = 'http://www.w3.org/2000/svg';
const R = 24, TL = 26, TW = 6;
const $ = id => document.getElementById(id);
const svg = $('svg');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let net, sim, log = [];
let mode = 'edit', tool = 'select', sel = null, arcFrom = null, arcPoints = [], clipboard = null;
let mouse = { x: 0, y: 0 }, drag = null, down = null, band = null;
const multi = new Set();
let counter = 0, pn = 0, tn = 0, patCount = 0;
let auto = false, acc = 0, description = '', suppressAuto = false, zoom = 1, firingRule = 'strong';
let demo = null, C = {};
const flash = {}, FLASH_MS = 700; // Demo-Modus: Zeitpunkt des letzten Schaltens je Transition (grünes Aufleuchten)
const DEMO_PREFLASH = 0.4; // Demo-Modus: Leuchtdauer vor dem Schalten in Simulationssekunden

const HINTS = {
  select: 'Elemente anklicken oder Rahmen aufziehen; Strg/Cmd-Klick fügt Elemente zur Auswahl hinzu. Strg/Cmd+C kopiert, Strg/Cmd+V fügt ein.',
  place: 'Klick auf die Fläche setzt eine Stelle.',
  trans: 'Klick auf die Fläche setzt eine Transition.',
  ttrans: 'Klick auf die Fläche setzt eine zeitbehaftete Transition.',
  arc: 'Quelle anklicken, dann beliebig viele Zwischenpunkte auf der Fläche und zuletzt das Zielelement (Stelle ↔ Transition).',
  token: 'Linksklick: Marke hinzufügen, Rechtsklick: Marke entfernen.',
  comment: 'Auf eine freie Stelle klicken und Text sowie Farbe in den Eigenschaften festlegen.',
  delete: 'Element anklicken, um es zu löschen.',
  sim: 'Aktivierte (grüne) Transition anklicken, um sie schalten zu lassen.'
};

/* ---------- Netzmodell ---------- */
function newNet() { net = { places: [], transitions: [], arcs: [], comments: [] }; counter = pn = tn = 0; sel = null; arcFrom = null; arcPoints = []; description = ''; }
const uid = () => 'n' + (++counter);
function addP(name, x, y, o = {}) {
  const p = { id: uid(), name: name || 'P' + (++pn), x, y, cap: o.cap ?? 1, m0: o.m0 ?? 0 };
  net.places.push(p); return p.id;
}
function addT(name, x, y, o = {}) {
  const t = { id: uid(), name: name || 'T' + (++tn), x, y, time: o.time ?? 0, vert: !o.h, span: o.span ?? TL };
  net.transitions.push(t); return t.id;
}
function addComment(text, x, y, color, o = {}) {
  const comment = { id: uid(), text, x, y, color, size: o.size ?? 14 };
  net.comments.push(comment); return comment.id;
}
const isPlace = id => net.places.some(p => p.id === id);
const node = id => net.places.find(p => p.id === id) || net.transitions.find(t => t.id === id);
function addA(from, to, w = 1) {
  if (isPlace(from) === isPlace(to)) return null;
  let a = net.arcs.find(a => a.from === from && a.to === to);
  if (!a) { a = { id: uid(), from, to, w }; net.arcs.push(a); }
  return a;
}
function removeNode(id) {
  net.places = net.places.filter(p => p.id !== id);
  net.transitions = net.transitions.filter(t => t.id !== id);
  net.arcs = net.arcs.filter(a => a.from !== id && a.to !== id);
  net.comments = net.comments.filter(c => c.id !== id);
}
function removeSel() {
  if (multi.size) { [...multi].forEach(removeNode); multi.clear(); sel = null; changed(); return; }
  if (!sel) return;
  if (sel.kind === 'a') net.arcs = net.arcs.filter(a => a.id !== sel.id); else removeNode(sel.id);
  sel = null; changed();
}
const getSel = () => sel && (sel.kind === 'a' ? net.arcs.find(a => a.id === sel.id) : sel.kind === 'c' ? net.comments.find(c => c.id === sel.id) : node(sel.id));
function getSelectedTransitions() {
  return multi.size
    ? [...multi].map(node).filter(item => item && !isPlace(item.id))
    : sel && sel.kind === 't' ? [node(sel.id)] : [];
}
function rotateSelectedTransitions() {
  const transitions = getSelectedTransitions();
  transitions.forEach(t => { t.vert = !t.vert; });
  setStatus(`${transitions.length} Transition${transitions.length === 1 ? '' : 'en'} gedreht.`);
  render();
}
const snap = v => Math.round(v / 10) * 10;

/* ---------- Simulation ---------- */
function resetSim() {
  suppressAuto = false;
  sim = { m: {}, busy: {}, time: 0, step: 0 };
  net.places.forEach(p => { if (p.cap > 0 && p.m0 > p.cap) p.m0 = p.cap; sim.m[p.id] = p.m0; });
  log = [];
}
function changed() { resetSim(); render(); }
const reserved = pid => net.arcs.filter(a => a.to === pid && sim.busy[a.from] !== undefined).reduce((s, a) => s + a.w, 0);
const heldByTimedTransition = pid => net.arcs.filter(a => a.from === pid && sim.busy[a.to] !== undefined).reduce((s, a) => s + a.w, 0);
function enabled(t) {
  if (sim.busy[t.id] !== undefined) return false;
  const ins = net.arcs.filter(a => a.to === t.id), outs = net.arcs.filter(a => a.from === t.id);
  if (ins.some(a => sim.m[a.from] < a.w)) return false;
  if (firingRule === 'weak') return true;
  return outs.every(a => {
    const p = node(a.to);
    if (p.cap === 0) return true;
    return sim.m[p.id] + reserved(p.id) + a.w <= p.cap;
  });
}
function addLog(before, text) {
  sim.step++;
  log.push({ step: sim.step, time: sim.time, text, before, m: { ...sim.m } });
  if (demo && log.length > 200) log.shift(); // Endlosbetrieb: Verlauf begrenzen
}
function fire(t) {
  if (!enabled(t)) return;
  const before = JSON.stringify(sim);
  if (demo) flash[t.id] = performance.now();
  net.arcs.filter(a => a.to === t.id).forEach(a => { sim.m[a.from] -= a.w; });
  if (t.time > 0) {
    sim.busy[t.id] = t.time;
    addLog(before, `${t.name} startet (T = ${t.time} s)`);
  } else {
    net.arcs.filter(a => a.from === t.id).forEach(a => { sim.m[a.to] += a.w; });
    addLog(before, `${t.name} schaltet`);
  }
  render();
}
function finishBusy() {
  Object.keys(sim.busy).filter(id => sim.busy[id] <= 1e-9).forEach(id => {
    const before = JSON.stringify(sim);
    net.arcs.filter(a => a.from === id).forEach(a => { sim.m[a.to] += a.w; });
    delete sim.busy[id];
    addLog(before, `${node(id).name} beendet`);
  });
}
function advance(dt) {
  while (dt > 1e-9 && Object.keys(sim.busy).length) {
    const step = Math.min(dt, ...Object.values(sim.busy));
    Object.keys(sim.busy).forEach(id => { sim.busy[id] -= step; });
    sim.time = Math.round((sim.time + step) * 1e6) / 1e6;
    dt -= step;
    finishBusy();
  }
}
function undo() {
  const e = log.pop();
  if (!e) return;
  suppressAuto = true;
  sim = JSON.parse(e.before);
  render();
}
function tick() {
  if (mode !== 'sim' || (demo && demo.paused)) return;
  const speed = parseFloat($('speed').value);
  const dt = 0.1 * speed;
  let dirty = false;
  if (!suppressAuto) net.transitions.filter(t => t.time > 0 && enabled(t)).forEach(t => { fire(t); dirty = true; });
  if (Object.keys(sim.busy).length) { advance(dt); dirty = true; }
  if (auto) {
    acc += dt;
    // Demo-Modus: die gewählte Transition leuchtet zuerst auf und schaltet erst danach
    if (demo && demo.pending) {
      demo.pending.left -= dt;
      if (demo.pending.left <= 1e-9) { const t = node(demo.pending.id); demo.pending = null; if (t) fire(t); }
      dirty = true;
    }
    if (acc >= 0.8) {
      acc = 0;
      const en = net.transitions.filter(t => t.time === 0 && enabled(t));
      const pick = en[Math.floor(Math.random() * en.length)];
      if (pick && demo) { demo.pending = { id: pick.id, left: DEMO_PREFLASH }; flash[pick.id] = performance.now(); }
      else if (pick) fire(pick);
      else if (demo && !Object.keys(sim.busy).length) resetSim();
      else if (!Object.keys(sim.busy).length) { setAuto(false); setStatus('Auto-Lauf beendet: keine Transition aktiviert (Verklemmung).'); }
      dirty = true;
    }
  }
  if (Object.keys(flash).length) dirty = true; // Aufleuchten ausblenden
  if (dirty) render();
}
function setAuto(v) {
  auto = v; acc = 0;
  $('btn-auto').textContent = auto ? '❚❚ Pause' : '▶ Auto-Lauf';
  $('btn-auto').classList.toggle('active', auto);
}

/* ---------- Geometrie ---------- */
function half(n) { return isPlace(n.id) ? [R, R] : (n.vert ? [TW, n.span] : [n.span, TW]); }
function clip(n, tx, ty) {
  const dx = tx - n.x, dy = ty - n.y, len = Math.hypot(dx, dy) || 1;
  if (isPlace(n.id)) return { x: n.x + dx / len * R, y: n.y + dy / len * R };
  const [hw, hh] = half(n);
  const k = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return { x: n.x + dx * k, y: n.y + dy * k };
}
function transitionSide(t, a) {
  const other = node(a.from === t.id ? a.to : a.from);
  const [hw, hh] = half(t);
  const dx = other.x - t.x, dy = other.y - t.y;
  if (Math.abs(dx) / hw >= Math.abs(dy) / hh) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}
function separateTransitionContact(point, t, a) {
  if (isPlace(t.id)) return point;
  const side = transitionSide(t, a);
  const contacts = net.arcs.filter(candidate =>
    (candidate.from === t.id || candidate.to === t.id) && transitionSide(t, candidate) === side);
  const incoming = contacts.filter(candidate => candidate.to === t.id);
  const outgoing = contacts.filter(candidate => candidate.from === t.id);
  if (!incoming.length || !outgoing.length) return point;

  const contactPosition = candidate => {
    const other = node(candidate.from === t.id ? candidate.to : candidate.from);
    return side === 'left' || side === 'right' ? other.y : other.x;
  };
  contacts.sort((left, right) => {
    const delta = contactPosition(left) - contactPosition(right);
    if (delta) return delta;
    return (left.to === t.id ? -1 : 1) - (right.to === t.id ? -1 : 1);
  });

  const [, hh] = half(t);
  const maxOffset = (side === 'left' || side === 'right' ? hh : half(t)[0]) - 3;
  const spacing = contacts.length > 1 ? Math.min(8, (2 * maxOffset) / (contacts.length - 1)) : 0;
  const offset = (contacts.indexOf(a) - (contacts.length - 1) / 2) * spacing;
  return side === 'left' || side === 'right'
    ? { x: point.x, y: point.y + offset }
    : { x: point.x + offset, y: point.y };
}
function smoothRoute(points) {
  if (points.length < 2) return '';
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i];
    const p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}
function routeMid(points) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const ratio = lengths[i] ? remaining / lengths[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * ratio, y: points[i].y + (points[i + 1].y - points[i].y) * ratio };
    }
    remaining -= lengths[i];
  }
  return points[0];
}
function arcGeom(a) {
  const A = node(a.from), B = node(a.to);
  if (a.points && a.points.length) {
    const waypoints = a.points;
    const p0 = separateTransitionContact(clip(A, waypoints[0].x, waypoints[0].y), A, a);
    const p2 = separateTransitionContact(clip(B, waypoints.at(-1).x, waypoints.at(-1).y), B, a);
    const points = [p0, ...waypoints, p2];
    return { p0, p2, mid: routeMid(points), d: smoothRoute(points), rev: false, points: waypoints };
  }
  const rev = net.arcs.some(r => r.from === a.to && r.to === a.from);
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
  const off = a.bend || (rev ? 44 : 0);
  const c = { x: (A.x + B.x) / 2 - dy / len * off, y: (A.y + B.y) / 2 + dx / len * off };
  const p0 = separateTransitionContact(clip(A, off ? c.x : B.x, off ? c.y : B.y), A, a);
  const p2 = separateTransitionContact(clip(B, off ? c.x : A.x, off ? c.y : A.y), B, a);
  const mid = { x: .25 * p0.x + .5 * c.x + .25 * p2.x, y: .25 * p0.y + .5 * c.y + .25 * p2.y };
  return { p0, c, p2, mid, d: `M${p0.x},${p0.y} Q${c.x},${c.y} ${p2.x},${p2.y}`, rev, points: [] };
}

/* ---------- Rendering ---------- */
function el(name, attrs, parent, text) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
// Zeichenfarben aus den CSS-Variablen (--pn-*) des aktuellen Farbschemas
function readColors() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue('--pn-' + n).trim();
  C = { ink: v('ink'), fill: v('fill'), sel: v('sel'), selWash: v('sel-wash'), weight: v('weight'), muted: v('muted'),
    on: v('on'), onTimed: v('on-timed'), busy: v('busy'), busyText: v('busy-text'), canvas: getComputedStyle(svg).backgroundColor };
}
// Schwarze Kommentare wären im Dunkelmodus unsichtbar und werden daher in der Textfarbe gezeichnet
const commentColor = c => (/^#(000|000000|222|222222)$/i.test(c) ? C.ink : c);
const DOTS = [[], [[0, 0]], [[-6, 0], [6, 0]], [[0, -7], [-7, 5], [7, 5]], [[-6, -6], [6, -6], [-6, 6], [6, 6]], [[-6, -6], [6, -6], [-6, 6], [6, 6], [0, 0]]];

function label(parent, owner, part, x, y, attrs, text) {
  const o = (owner.off && owner.off[part]) || [0, 0];
  const g = el('g', { 'data-kind': 'label', 'data-id': owner.id, 'data-part': part, style: 'cursor:move' }, parent);
  return el('text', { x: x + o[0], y: y + o[1], ...attrs }, g, text);
}
const getObj = id => net.arcs.find(a => a.id === id) || node(id);
function ownerHit(id) { return { kind: net.arcs.some(a => a.id === id) ? 'a' : (isPlace(id) ? 'p' : 't'), id }; }

function render() {
  svg.innerHTML = '';
  $('btn-rotate').disabled = mode !== 'edit' || !getSelectedTransitions().length;
  const defs = el('defs', {}, svg);
  [['arr', C.ink], ['arrSel', C.sel]].forEach(([id, col]) => {
    const m = el('marker', { id, markerWidth: 11, markerHeight: 9, refX: 10, refY: 4.5, orient: 'auto', markerUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M0,0 L11,4.5 L0,9 z', fill: col }, m);
  });
  const isSel = (k, id) => (sel && sel.kind === k && sel.id === id) || (k !== 'a' && multi.has(id));

  net.arcs.forEach(a => {
    const g = arcGeom(a), s = isSel('a', a.id);
    const d = g.d;
    const grp = el('g', { 'data-kind': 'a', 'data-id': a.id }, svg);
    el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14 }, grp);
    el('path', { d, fill: 'none', stroke: s ? C.sel : C.ink, 'stroke-width': 1.5, 'marker-end': `url(#${s ? 'arrSel' : 'arr'})` }, grp);
    if (a.w > 1) {
      label(grp, a, 'w', g.mid.x, g.mid.y - 6, { 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600, fill: C.weight, stroke: C.canvas, 'stroke-width': 3, 'paint-order': 'stroke' }, a.w);
    }
    if (mode === 'edit') {
      g.points.forEach((p, index) => el('circle', {
        cx: p.x, cy: p.y, r: 5, fill: C.sel, stroke: C.canvas, 'stroke-width': 1.5,
        'data-kind': 'waypoint', 'data-id': a.id, 'data-index': index, style: 'cursor:move'
      }, grp));
    }
  });

  net.comments.forEach(c => {
    const selected = isSel('c', c.id);
    const g = el('g', { 'data-kind': 'c', 'data-id': c.id, style: 'cursor:move' }, svg);
    const size = c.size || 14;
    const width = Math.max(30, c.text.length * size * .55);
    el('rect', { x: c.x - 4, y: c.y - size, width: width + 8, height: size + 7, fill: selected ? C.selWash : 'transparent', stroke: selected ? C.sel : 'transparent', 'stroke-width': 1 }, g);
    el('text', { x: c.x, y: c.y, fill: commentColor(c.color), 'font-size': size }, g, c.text);
  });

  net.places.forEach(p => {
    const g = el('g', { 'data-kind': 'p', 'data-id': p.id, style: 'cursor:pointer' }, svg);
    el('circle', { cx: p.x, cy: p.y, r: R, fill: C.fill, stroke: isSel('p', p.id) ? C.sel : C.ink, 'stroke-width': 2 }, g);
    const n = sim.m[p.id] + heldByTimedTransition(p.id);
    if (n >= 1 && n <= 5) DOTS[n].forEach(([dx, dy]) => el('circle', { cx: p.x + dx, cy: p.y + dy, r: 4, fill: C.ink }, g));
    else if (n > 5) el('text', { x: p.x, y: p.y + 5, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700 }, g, n);
    label(g, p, 'name', p.x, p.y + R + 15, { 'text-anchor': 'middle', 'font-size': 12 }, p.name);
    if (p.cap !== 1) label(g, p, 'cap', p.x + R * .75, p.y - R * .75, { 'font-size': 12, fill: C.muted }, 'k=' + (p.cap || '∞'));
  });

  net.transitions.forEach(t => {
    const g = el('g', { 'data-kind': 't', 'data-id': t.id, style: 'cursor:pointer' }, svg);
    const [hw, hh] = half(t), busy = sim.busy[t.id] !== undefined;
    const en = mode === 'sim' && enabled(t), timed = t.time > 0;
    let fill = timed ? C.fill : C.ink;
    if (busy) fill = C.busy; else if (en) fill = timed ? C.onTimed : C.on;
    const stroke = isSel('t', t.id) ? C.sel : (en ? C.on : C.ink);
    el('rect', { x: t.x - hw - 5, y: t.y - hh - 5, width: 2 * hw + 10, height: 2 * hh + 10, fill: 'transparent' }, g);
    el('rect', { x: t.x - hw, y: t.y - hh, width: 2 * hw, height: 2 * hh, fill, stroke, 'stroke-width': 2 }, g);
    if (flash[t.id] !== undefined) {
      const glow = demo && demo.pending && demo.pending.id === t.id ? 1 : 1 - (performance.now() - flash[t.id]) / FLASH_MS;
      if (glow > 0) el('rect', { x: t.x - hw - 6, y: t.y - hh - 6, width: 2 * hw + 12, height: 2 * hh + 12, rx: 3, fill: 'none', stroke: C.on, 'stroke-width': 4,
        opacity: glow, 'pointer-events': 'none', style: `filter: drop-shadow(0 0 5px ${C.on})` }, g);
      else delete flash[t.id];
    }
    if (!t.hideName) label(g, t, 'name', t.x, t.y + hh + 16, { 'text-anchor': 'middle', 'font-size': 12 }, t.name);
    if (timed) label(g, t, 'time', t.x, t.y + hh + 29, { 'text-anchor': 'middle', 'font-size': 11, fill: busy ? C.busyText : C.muted },
      busy ? `noch ${sim.busy[t.id].toFixed(1)} s` : `T=${t.time} s`);
  });

  if (band && down && down.moved) {
    el('rect', { x: Math.min(band.x, mouse.x), y: Math.min(band.y, mouse.y), width: Math.abs(mouse.x - band.x), height: Math.abs(mouse.y - band.y), fill: C.sel, 'fill-opacity': .12, stroke: C.sel, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }, svg);
  }
  if (arcFrom) {
    const n = node(arcFrom);
    const points = [n, ...arcPoints, mouse];
    el('path', { d: smoothRoute(points), fill: 'none', stroke: C.sel, 'stroke-dasharray': '5 4', 'pointer-events': 'none' }, svg);
    arcPoints.forEach(p => el('circle', { cx: p.x, cy: p.y, r: 4, fill: C.sel, 'pointer-events': 'none' }, svg));
  }
  renderInfo(); renderProps(); renderLog();
}

function renderInfo() {
  const transit = net.places.reduce((s, p) => s + heldByTimedTransition(p.id), 0);
  const tokens = Object.values(sim.m).reduce((s, v) => s + v, 0) + transit;
  const nEn = net.transitions.filter(enabled).length;
  let h = description ? `<div class="desc">${esc(description)}</div>` : '';
  h += `<table>
    <tr><td>Stellen</td><td>${net.places.length}</td></tr>
    <tr><td>Transitionen</td><td>${net.transitions.length}</td></tr>
    <tr><td>Kanten</td><td>${net.arcs.length}</td></tr>
    <tr><td>Marken aktuell im Netz</td><td>${tokens}</td></tr>
    <tr><td>Marken in zeitbehafteten Transitionen</td><td>${transit}</td></tr>
    <tr><td>Aktivierte Transitionen</td><td>${nEn}</td></tr>
    <tr><td>Schaltregel</td><td>${firingRule === 'strong' ? 'stark' : 'schwach'}</td></tr>
    <tr><td>Schaltschritte</td><td>${sim.step}</td></tr>
    <tr><td>Simulationszeit</td><td>${sim.time.toFixed(1)} s</td></tr>
  </table><h3>Markierung</h3><table>`;
  net.places.forEach(p => {
    const marking = sim.m[p.id] + heldByTimedTransition(p.id);
    h += `<tr><td>${esc(p.name)}</td><td>${marking} / ${p.cap || '∞'}</td></tr>`;
  });
  $('info').innerHTML = h + '</table>';
}

function renderLog() {
  const ol = $('log');
  const atEnd = ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 4;
  ol.innerHTML = log.map(e => {
    const m = net.places.filter(p => e.m[p.id]).map(p => `${esc(p.name)}: ${e.m[p.id]}`).join(', ') || '(leer)';
    return `<li><b>${esc(e.text)}</b> <span>(t = ${e.time.toFixed(1)} s)</span><span class="m">${m}</span></li>`;
  }).join('');
  if (atEnd) ol.scrollTop = ol.scrollHeight;
}

function renderProps() {
  const box = $('props');
  if (box.contains(document.activeElement) && document.activeElement !== box) return;
  const o = getSel();
  if (!o) { box.innerHTML = '<p class="hint">Nichts ausgewählt.</p>'; return; }
  let h = '';
  if (sel.kind === 'p') {
    h = `<div class="field"><label>Name</label><input id="f-name" value="${esc(o.name)}"></div>
      <div class="field"><label>Kapazität k (0 = ∞)</label><input id="f-cap" type="number" min="0" value="${o.cap}"></div>
      <div class="field"><label>Anfangsmarken</label><input id="f-m0" type="number" min="0" value="${o.m0}"></div>`;
  } else if (sel.kind === 't') {
    h = `<div class="field"><label>Name</label><input id="f-name" value="${esc(o.name)}"></div>
      <div class="field"><label>Zeit T in s (0 = sofort)</label><input id="f-time" type="number" min="0" step="0.5" value="${o.time}"></div>
      <div class="field"><label>Ausrichtung</label><select id="f-vert"><option value="1"${o.vert ? ' selected' : ''}>senkrecht</option><option value="0"${o.vert ? '' : ' selected'}>waagerecht</option></select></div>`;
  } else if (sel.kind === 'a') {
    h = `<div class="field"><label>Kante</label><span>${esc(node(o.from).name)} → ${esc(node(o.to).name)}</span></div>
      <div class="field"><label>Gewicht w</label><input id="f-w" type="number" min="1" step="1" value="${o.w}"></div>`;
  } else {
    h = `<div class="field"><label>Text</label><input id="f-text" value="${esc(o.text)}"></div>
      <div class="field"><label>Farbe</label><input id="f-color" type="color" value="${esc(o.color)}"></div>`;
  }
  box.innerHTML = h + '<button id="f-del">Löschen</button>';
  const bind = (id, fn) => { const e = $(id); if (e) e.addEventListener('change', fn); };
  bind('f-name', e => { o.name = e.target.value; render(); });
  bind('f-cap', e => { o.cap = Math.max(0, parseInt(e.target.value) || 0); changed(); });
  bind('f-m0', e => { o.m0 = Math.max(0, parseInt(e.target.value) || 0); changed(); });
  bind('f-time', e => { o.time = Math.max(0, parseFloat(e.target.value) || 0); changed(); });
  bind('f-vert', e => { o.vert = e.target.value === '1'; render(); });
  bind('f-w', e => { o.w = Math.max(1, parseInt(e.target.value) || 1); changed(); });
  bind('f-text', e => { o.text = e.target.value; render(); });
  bind('f-color', e => { o.color = e.target.value; render(); });
  $('f-del').addEventListener('click', removeSel);
}

/* ---------- Interaktion ---------- */
function pt(e) { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; }

const VW = 1600, VH = 900;
svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
function fitNetToViewport() {
  const wrap = $('wrap');
  const bounds = svg.getBBox();
  if (!bounds.width || !bounds.height || !wrap.clientWidth || !wrap.clientHeight) {
    setStatus('Kein Netz zum Einpassen vorhanden.');
    return;
  }

  const margin = .05, top = demo ? 64 : 0; // im Demo-Modus Platz für das Banner lassen
  zoom = Math.min(
    wrap.clientWidth * (1 - 2 * margin) / bounds.width,
    (wrap.clientHeight - top) * (1 - 2 * margin) / bounds.height
  );
  svg.setAttribute('width', VW * zoom);
  svg.setAttribute('height', VH * zoom);
  svg.style.marginLeft = '0';
  svg.style.marginTop = '0';
  const targetScrollLeft = (bounds.x + bounds.width / 2) * zoom - wrap.clientWidth / 2;
  const targetScrollTop = (bounds.y + bounds.height / 2) * zoom - (wrap.clientHeight + top) / 2;
  svg.style.marginLeft = `${Math.max(0, -targetScrollLeft)}px`;
  svg.style.marginTop = `${Math.max(0, -targetScrollTop)}px`;
  wrap.scrollLeft = Math.max(0, targetScrollLeft);
  wrap.scrollTop = Math.max(0, targetScrollTop);
  setStatus(`Ansicht eingepasst (${Math.round(zoom * 100)} %).`);
}
$('wrap').addEventListener('wheel', e => {
  e.preventDefault();
  const w = $('wrap'), r = svg.getBoundingClientRect(), wr = w.getBoundingClientRect();
  const px = (e.clientX - r.left) / zoom, py = (e.clientY - r.top) / zoom;
  zoom = Math.min(3, Math.max(0.25, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  svg.setAttribute('width', VW * zoom); svg.setAttribute('height', VH * zoom);
  w.scrollLeft = px * zoom - (e.clientX - wr.left);
  w.scrollTop = py * zoom - (e.clientY - wr.top);
  setStatus(`Zoom ${Math.round(zoom * 100)} %`);
}, { passive: false });
function hitOf(target) {
  const g = target.closest && target.closest('[data-kind]');
  return g ? { kind: g.dataset.kind, id: g.dataset.id, part: g.dataset.part, index: g.dataset.index } : null;
}
function setStatus(s) { $('status').textContent = s; }
function setTool(t) {
  tool = t; arcFrom = null; arcPoints = [];
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  setStatus(HINTS[t]); render();
}
function setMode(m) {
  mode = m; setAuto(false);
  document.body.classList.remove('edit', 'sim');
  document.body.classList.add(m);
  $('mode-edit').classList.toggle('active', m === 'edit');
  $('mode-sim').classList.toggle('active', m === 'sim');
  if (m === 'edit') { resetSim(); setTool('select'); } else { arcFrom = null; setStatus(HINTS.sim); render(); }
}

svg.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const p = pt(e);
  let hit = hitOf(e.target), lab = null;
  if (hit && hit.kind === 'label') { lab = hit; hit = ownerHit(hit.id); }
  const waypoint = hit && hit.kind === 'waypoint' ? hit : null;
  if (waypoint) hit = { kind: 'a', id: waypoint.id };
  down = { p, hit, moved: false, additive: e.ctrlKey || e.metaKey || e.shiftKey };
  if (lab && (tool === 'select' || mode === 'sim')) {
    const o = getObj(lab.id), off = (o.off && o.off[lab.part]) || [0, 0];
    drag = { label: { o, part: lab.part, x: off[0], y: off[1] } };
  } else if (waypoint && mode === 'edit' && tool === 'select') {
    const arc = net.arcs.find(a => a.id === waypoint.id);
    const index = Number(waypoint.index);
    if (arc && arc.points && arc.points[index]) {
      sel = { kind: 'a', id: arc.id };
      drag = { waypoint: { arc, index, x: arc.points[index].x, y: arc.points[index].y } };
    }
  } else if (tool === 'select' || mode === 'sim') {
    if (hit && hit.kind !== 'a') {
      const ids = multi.has(hit.id) ? [...multi] : [hit.id];
      drag = { items: ids.map(id => {
        const n = net.comments.find(c => c.id === id) || node(id);
        return { n, x: n.x, y: n.y };
      }) };
    } else if (!hit) band = { x: p.x, y: p.y };
  }
});
svg.addEventListener('mousemove', e => {
  mouse = pt(e);
  if (down && Math.hypot(mouse.x - down.p.x, mouse.y - down.p.y) > 4) down.moved = true;
  if (drag && drag.label && down && down.moved) {
    const L = drag.label;
    L.o.off = L.o.off || {};
    L.o.off[L.part] = [L.x + mouse.x - down.p.x, L.y + mouse.y - down.p.y];
    render();
  } else if (drag && drag.waypoint && down && down.moved) {
    const W = drag.waypoint;
    W.arc.points[W.index] = { x: W.x + mouse.x - down.p.x, y: W.y + mouse.y - down.p.y };
    render();
  } else if (drag && down && down.moved) {
    const minX = Math.min(...drag.items.map(i => i.x)), minY = Math.min(...drag.items.map(i => i.y));
    const dx = Math.max(30 - minX, snap(mouse.x - down.p.x)), dy = Math.max(30 - minY, snap(mouse.y - down.p.y));
    drag.items.forEach(i => { i.n.x = i.x + dx; i.n.y = i.y + dy; });
    render();
  } else if (band && down && down.moved) render();
  else if (arcFrom) render();
});
window.addEventListener('mouseup', () => {
  if (!down) return;
  const d = down, b = band; down = null; drag = null; band = null;
  if (b && d.moved) {
    const x0 = Math.min(b.x, mouse.x), x1 = Math.max(b.x, mouse.x), y0 = Math.min(b.y, mouse.y), y1 = Math.max(b.y, mouse.y);
    multi.clear(); sel = null;
    [...net.places, ...net.transitions].forEach(n => { if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) multi.add(n.id); });
    render();
  } else if (!d.moved) onClick(d.hit, d.p, d.additive);
});
svg.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (mode !== 'edit') return;
  let hit = hitOf(e.target);
  if (hit && hit.kind === 'label') hit = ownerHit(hit.id);
  if (hit && hit.kind === 'p') { const p = node(hit.id); if (p.m0 > 0) { p.m0--; changed(); } }
});

function onClick(hit, p, additive = false) {
  if (tool !== 'select' || !additive) multi.clear();
  if (mode === 'sim') {
    if (hit && hit.kind === 't') {
      sel = hit; const t = node(hit.id);
      if (t.time > 0) setStatus(`„${t.name}" ist zeitbehaftet und schaltet automatisch, sobald sie aktiviert ist.`);
      else if (enabled(t)) { suppressAuto = false; fire(t); return; }
      else setStatus(`„${t.name}" ist nicht aktiviert.`);
      render();
    }
    else { sel = hit; render(); }
    return;
  }
  const x = snap(p.x), y = snap(p.y);
  switch (tool) {
    case 'select':
      if (additive && hit && hit.kind !== 'a') {
        if (sel && sel.kind !== 'a' && !multi.size) multi.add(sel.id);
        if (multi.has(hit.id)) {
          multi.delete(hit.id);
          const nextId = [...multi].at(-1);
          sel = nextId ? { kind: isPlace(nextId) ? 'p' : (node(nextId) ? 't' : 'c'), id: nextId } : null;
        } else { multi.add(hit.id); sel = hit; }
      } else { if (!additive) multi.clear(); sel = hit; }
      render(); break;
    case 'place': if (hit) { sel = hit; render(); } else { sel = { kind: 'p', id: addP('', x, y) }; changed(); } break;
    case 'trans': if (hit) { sel = hit; render(); } else { sel = { kind: 't', id: addT('', x, y) }; changed(); } break;
    case 'ttrans': if (hit) { sel = hit; render(); } else { sel = { kind: 't', id: addT('', x, y, { time: 1 }) }; changed(); } break;
    case 'comment':
      if (hit) { sel = hit; render(); break; }
      sel = { kind: 'c', id: addComment('Kommentar', x, y, $('comment-color').value) };
      changed();
      setStatus('Kommentar hinzugefügt. Text und Farbe können in den Eigenschaften geändert werden.');
      break;
    case 'arc':
      if (!hit) {
        if (arcFrom) arcPoints.push({ x, y });
        else setStatus('Zum Starten einer Kante zuerst eine Stelle oder Transition anklicken.');
        render(); break;
      }
      if (hit.kind === 'a') { arcFrom = null; arcPoints = []; render(); break; }
      if (!arcFrom) { arcFrom = hit.id; arcPoints = []; render(); break; }
      if (isPlace(arcFrom) === isPlace(hit.id)) { setStatus('Kanten verbinden nur Stelle ↔ Transition.'); render(); break; }
      { const a = addA(arcFrom, hit.id); if (arcPoints.length) a.points = arcPoints.map(point => ({ ...point })); sel = { kind: 'a', id: a.id }; arcFrom = null; arcPoints = []; setStatus(HINTS.arc); changed(); }
      break;
    case 'token':
      if (hit && hit.kind === 'p') {
        const pl = node(hit.id);
        if (pl.cap === 0 || pl.m0 < pl.cap) { pl.m0++; changed(); } else setStatus(`Kapazität von „${pl.name}" erreicht.`);
      }
      break;
    case 'delete': if (hit) { sel = hit; removeSel(); } break;
  }
}

function copySelection() {
  const selected = new Set(multi);
  if (sel && ['p', 't', 'c'].includes(sel.kind)) selected.add(sel.id);
  const selectedArc = sel && sel.kind === 'a' ? net.arcs.find(a => a.id === sel.id) : null;
  if (selectedArc) { selected.add(selectedArc.from); selected.add(selectedArc.to); }
  const nodeIds = new Set([...net.places, ...net.transitions].filter(item => selected.has(item.id)).map(item => item.id));
  const places = net.places.filter(p => nodeIds.has(p.id));
  const transitions = net.transitions.filter(t => nodeIds.has(t.id));
  const comments = net.comments.filter(c => selected.has(c.id));
  const arcs = net.arcs.filter(a => nodeIds.has(a.from) && nodeIds.has(a.to) && (nodeIds.size > (selectedArc ? 2 : 0) || a.id === selectedArc?.id));
  if (!places.length && !transitions.length && !comments.length) { setStatus('Zum Kopieren zuerst Elemente auswählen.'); return; }
  clipboard = JSON.parse(JSON.stringify({ places, transitions, comments, arcs, pastes: 0 }));
  setStatus(`${places.length + transitions.length + comments.length} Element${places.length + transitions.length + comments.length === 1 ? '' : 'e'} kopiert.`);
}

function pasteSelection() {
  if (!clipboard) { setStatus('Noch keine Elemente kopiert.'); return; }
  const offset = 40 * ++clipboard.pastes, ids = new Map(), pasted = [];
  const clone = (item, type) => {
    const copy = { ...item, id: uid(), x: item.x + offset, y: item.y + offset };
    if (type === 'p') net.places.push(copy);
    else if (type === 't') net.transitions.push(copy);
    else net.comments.push(copy);
    ids.set(item.id, copy.id); pasted.push(copy.id);
  };
  clipboard.places.forEach(item => clone(item, 'p'));
  clipboard.transitions.forEach(item => clone(item, 't'));
  clipboard.comments.forEach(item => clone(item, 'c'));
  clipboard.arcs.forEach(item => {
    const copy = { ...item, id: uid(), from: ids.get(item.from), to: ids.get(item.to) };
    if (item.points) copy.points = item.points.map(point => ({ x: point.x + offset, y: point.y + offset }));
    net.arcs.push(copy);
  });
  pn = net.places.length; tn = net.transitions.length;
  multi.clear(); pasted.forEach(id => multi.add(id));
  const first = pasted[0];
  sel = first ? { kind: isPlace(first) ? 'p' : (node(first) ? 't' : 'c'), id: first } : null;
  changed();
  setStatus(`${pasted.length} Element${pasted.length === 1 ? '' : 'e'} eingefügt.`);
}

document.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'c' && mode === 'edit') { e.preventDefault(); copySelection(); }
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'v' && mode === 'edit') { e.preventDefault(); pasteSelection(); }
  if (mode === 'edit' && (e.key === 'Delete') && !typing) removeSel();
  if (demo) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // kein Auslösen fokussierter Buttons
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); toggleDemoPause(); return; }
    if (e.key === '+' || e.key === 'ArrowUp') { e.preventDefault(); stepDemoSpeed(1); return; }
    if (e.key === '-' || e.key === 'ArrowDown') { e.preventDefault(); stepDemoSpeed(-1); return; }
  }
  if ((e.key === ' ' || e.code === 'Space') && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) {
    e.preventDefault();
    fitNetToViewport();
  }
  if (e.key === 'Escape') { if (demo) stopDemo(); arcFrom = null; render(); }
});

/* ---------- Bausteine ---------- */
function addPattern(kind) {
  setMode('edit');
  const w = $('wrap'), k = patCount++;
  const ox = w.scrollLeft / zoom + 70 + (k % 3) * 340, oy = w.scrollTop / zoom + 70 + (Math.floor(k / 3) % 3) * 200;
  const P = (n, x, y, m0 = 0, cap = 1) => addP(n, ox + x, oy + y, { m0, cap });
  const T = (n, x, y) => addT(n, ox + x, oy + y);
  const A = addA;
  let ids;
  if (kind === 'seq') {
    const m = P('Zm', 0, 50, 1), x = T('x', 100, 50), n = P('Zn', 200, 50);
    A(m, x); A(x, n); ids = [m, x, n];
  } else if (kind === 'altBranch') {
    const m = P('Zm', 0, 60, 1), x1 = T('x1', 100, 20), x2 = T('x2', 100, 100), n = P('Zn', 200, 20), p = P('Zp', 200, 100);
    A(m, x1); A(m, x2); A(x1, n); A(x2, p); ids = [m, x1, x2, n, p];
  } else if (kind === 'parBranch') {
    const m = P('Zm', 0, 60, 1), x = T('x', 100, 60), n = P('Zn', 200, 20), p = P('Zp', 200, 100);
    A(m, x); A(x, n); A(x, p); ids = [m, x, n, p];
  } else if (kind === 'altMerge') {
    const m = P('Zm', 0, 20, 1), n = P('Zn', 0, 100, 1), x1 = T('x1', 100, 20), x2 = T('x2', 100, 100), p = P('Zp', 200, 60);
    A(m, x1); A(n, x2); A(x1, p); A(x2, p); ids = [m, n, x1, x2, p];
  } else {
    const m = P('Zm', 0, 20, 1), n = P('Zn', 0, 100, 1), x = T('x', 100, 60), p = P('Zp', 200, 60);
    A(m, x); A(n, x); A(x, p); ids = [m, n, x, p];
  }
  pn = net.places.length; tn = net.transitions.length;
  sel = { kind: isPlace(ids[0]) ? 'p' : 't', id: ids[0] };
  changed();
}

/* ---------- Beispiele ---------- */
function carWash(n, dTime, desc) {
  description = desc;
  const setLabelOffset = (id, part, x, y) => {
    const item = node(id);
    item.off = item.off || {};
    item.off[part] = [x, y];
  };
  const a = addT('a', 100, 20, { h: true });
  const W = addP('Warteschlange (W)', 100, 110, { cap: 0 });
  const M = addP('Waschplatz verfügbar (M)', 350, 110, { cap: n, m0: n });
  const s = addT('s', 225, 190, { h: true });
  const B = addP('Auto wird gewaschen (B)', 225, 275, { cap: n });
  const d = addT('d', 225, 365, { h: true, time: dTime });
  const K = addP('Bediente Kunden (K)', 100, 400, { cap: 0 });
  setLabelOffset(a, 'name', -42, -21);
  setLabelOffset(W, 'name', -31, 9);
  setLabelOffset(M, 'name', 0, -76);
  setLabelOffset(s, 'name', -41, -16);
  setLabelOffset(B, 'name', -105, -29);
  setLabelOffset(d, 'name', 0, 6);
  setLabelOffset(d, 'time', 42, -4);
  setLabelOffset(K, 'name', 0, 7);
  setLabelOffset(K, 'cap', 0, -13);
  [[a, W], [W, s], [M, s], [s, B], [B, d], [d, K], [d, M]].forEach(([x, y]) => addA(x, y));
}
const EXAMPLES = {
  car1: () => carWash(1, 0, 'Petrinetz für Waschanlage mit 1 Waschplatz. Transition a (Ankunft), s (Start Waschen) und d (Ende) schalten per Klick.'),
  car2: () => carWash(2, 0, 'Petrinetz für Waschanlage mit 2 Waschplätzen (M hat 2 Marken, k = 2).'),
  car3: () => carWash(1, 10, 'Petrinetz für Waschanlage mit 1 Waschplatz und zeitlicher Taktung: Die Transition d ist zeitbehaftet (T = 10, hier in Sekunden statt Minuten) und schaltet automatisch, sobald sie aktiviert ist.'),
  container() {
    description = 'Container-Entladestation: Zwei Entladeplätze teilen sich einen Kran (Stelle „Kran in Wartestellung"). Ein Schiff kann nur entladen werden, wenn Platz und Kran frei sind.';
    const setLabelOffset = (id, part, x, y) => {
      const item = node(id);
      item.off = item.off || {};
      item.off[part] = [x, y];
    };
    const wait = addP('Schiff auf Warteplatz', 140, 365, { cap: 0 });
    const src = addT('Einfahrt Schiff', 40, 365);
    addA(src, wait);
    const kran = addP('Kran in Wartestellung', 630, 345, { m0: 1 });
    const hafen = addP('Schiff in Ausfahrt', 1240, 325, { cap: 0 });
    const sink = addT('Schiff verlässt Hafen', 1410, 325);
    addA(hafen, sink);
    [[1, 217, 57, 372], [2, 487, 627, 392]].forEach(([n, row, yf, xf]) => {
      const frei = addP(`Entladeplatz ${n} frei`, xf, yf, { m0: 1 });
      const ta = addT(`Schiff fährt auf Platz ${n}`, 242, row);
      const bes = addP(`Entladeplatz ${n} besetzt`, 382, row);
      const ts = addT(`Start Entladung Platz ${n}`, 502, row);
      const ent = addP(`Schiff & Kran bei Entladung ${n}`, 632, row);
      const te = addT(`Entladung abgeschlossen ${n}`, 782, row);
      const fertig = addP(`Schiff entladen ${n}`, 922, row);
      const tf = addT(`Schiff fährt ab von Platz ${n}`, 1102, row);
      if (n === 1) {
        setLabelOffset(frei, 'name', -106, -56);
        setLabelOffset(ta, 'name', -92, -51);
        setLabelOffset(ts, 'name', -10, -84);
        setLabelOffset(te, 'name', -34, -84);
        setLabelOffset(tf, 'name', 8, -84);
      } else {
        setLabelOffset(ta, 'name', -86, -22);
        setLabelOffset(bes, 'name', 0, -80);
        setLabelOffset(ent, 'name', 0, -80);
        setLabelOffset(fertig, 'name', 0, -80);
      }
      addA(wait, ta); addA(frei, ta); addA(ta, bes); addA(bes, ts); addA(kran, ts); addA(ts, ent);
      addA(ent, te); addA(te, kran); addA(te, fertig); addA(fertig, tf); addA(tf, frei); addA(tf, hafen);
    });
    setLabelOffset(wait, 'name', 88, -41);
    setLabelOffset(wait, 'cap', -60, -23);
    setLabelOffset(kran, 'name', 103, -36);
    setLabelOffset(hafen, 'name', -89, -33);
    setLabelOffset(hafen, 'cap', -4, -14);
    setLabelOffset(sink, 'name', -31, 1);
  },
  production() {
    description = 'Produktionsprozess (S/T-Netz): Rohteile werden paarweise angeliefert (w = 2) und auf dem Warteplatz (k = 6) bereitgestellt. 2 Maschinen bearbeiten bis zu 2 Teile gleichzeitig, danach prüft ein einzelner Mitarbeiter jedes Teil. Gute Teile kommen auf den Lagerplatz (k = 10); sind 10 Teile gesammelt, werden sie abtransportiert (w = 10). Ausschuss wird entsorgt.';
    const nodeAt = (id, lx, ly, y0) => { const o = node(id); o.off = { name: [lx - o.x, ly + 4 - (o.y + y0)] }; return o; };
    const P = (name, x, y, lx, ly, o, capPos) => {
      const id = addP(name, x, y, o), p = nodeAt(id, lx, ly, R + 15);
      if (capPos) p.off.cap = [capPos[0] - 6 - (x + R * .75), capPos[1] + 4 - (y - R * .75)];
      return id;
    };
    const T = (name, x, y, lx, ly, hide) => { const id = addT(name, x, y); nodeAt(id, lx, ly, TL + 16).hideName = hide; return id; };
    const anl = T('Anlieferung', 60, 104, 45, 78);
    const W = P('Warteplatz', 162, 105, 151, 72, { cap: 6 }, [159, 132]);
    const M = P('Maschine frei', 162, 180, 102, 185, { cap: 2, m0: 2 }, [162, 209]);
    const t1 = T('Start Bearbeitung', 240, 135, 240, 135, true);
    const B = P('Bearbeitung', 316, 135, 318, 104, { cap: 2 }, [314, 172]);
    const t2 = T('Ende Bearbeitung', 394, 145, 394, 145, true);
    const Q = P('Qualitätskontrolle', 468, 146, 468, 113, {});
    const io = T('Teil i.O.', 565, 112, 555, 71);
    const aus = T('Ausschuss wird entsorgt', 565, 182, 577, 217);
    const L = P('Lagerplatz', 657, 81, 658, 52, { cap: 10 }, [654, 114]);
    const ab = T('Abtransport', 760, 80, 761, 43);
    [[W, t1], [M, t1], [t1, B], [B, t2], [t2, Q], [Q, io], [Q, aus], [io, L]].forEach(([a, b]) => addA(a, b));
    addA(anl, W, 2).off = { w: [0, 23] };
    addA(L, ab, 10).off = { w: [0, 18] };
    addA(t2, M).bend = -88;
  },
  producerConsumer() {
    description = 'Produzent-Verbraucher mit begrenztem Puffer: Der Puffer fasst maximal drei Teile. Die Produktion (T = 2 s) benötigt einen freien Platz; der Verbrauch (T = 3 s) gibt ihn nach Abschluss wieder frei. Produzent und Verbraucher können jeweils nur einen Vorgang gleichzeitig bearbeiten.';
    const producer = addP('Produzent bereit', 150, 240, { m0: 1 });
    const produce = addT('Produzieren', 410, 240, { time: 2 });
    const items = addP('Teil im Puffer', 700, 240, { cap: 3 });
    const consume = addT('Verbrauchen', 990, 240, { time: 3 });
    const consumer = addP('Verbraucher bereit', 1260, 240, { m0: 1 });
    const free = addP('Freie Pufferplätze', 700, 470, { cap: 3, m0: 3 });
    [producer, produce, items, consume, consumer].forEach(id => { node(id).off = { name: [0, -72] }; });
    node(free).off = { name: [0, 70] };
    [[producer, produce], [produce, producer], [free, produce], [produce, items],
      [items, consume], [consumer, consume], [consume, consumer], [consume, free]].forEach(([from, to]) => addA(from, to));
  },
  millDrill() {
    description = 'Produktionsprozess: Ein Auftrag wird parallel in Fräsen und Bohren aufgeteilt (parallele Verzweigung). Die Teile werden montiert (parallele Vereinigung) und anschließend alternativ als Gut- oder Ausschussteil geprüft.';
    const down = 40;
    const P = (name, x, y, options) => addP(name, x, y + down, options);
    const T = (name, x, y, options) => addT(name, x, y + down, options);
    const src = T('Auftrag geht ein', 60, 200);
    const auf = P('Aufträge', 160, 200, { cap: 3, m0: 2 });
    const frg = T('Freigabe', 260, 200);
    const ra = P('Rohteil A', 360, 110, { cap: 2 });
    const rb = P('Rohteil B', 360, 290, { cap: 2 });
    const fraese = P('Fräse frei', 460, 20, { m0: 1 });
    const tf = T('Fräsen', 460, 110, { time: 2 });
    const bohrer = P('Bohrer frei', 460, 380, { m0: 1 });
    const tb = T('Bohren', 460, 290, { time: 3 });
    const fa = P('Teil A fertig', 570, 110, { cap: 2 });
    const fb = P('Teil B fertig', 570, 290, { cap: 2 });
    const monteur = P('Monteur frei', 690, 110, { m0: 1 });
    const tm = T('Montage', 690, 200, { time: 2 });
    const prod = P('Produkt', 790, 200);
    const tok = T('Prüfung i.O.', 890, 130);
    const tn_ = T('Prüfung n.i.O.', 890, 270);
    const gut = P('Gutteile', 990, 130, { cap: 0 });
    const schrott = P('Ausschuss', 990, 270, { cap: 0 });
    node(fraese).off = { name: [0, -79] };
    node(fb).off = { cap: [-27, -17] };
    node(monteur).off = { name: [0, -75] };
    node(tok).off = { name: [-8, -78] };
    [[src, auf], [auf, frg], [frg, ra], [frg, rb], [ra, tf], [fraese, tf], [tf, fraese], [tf, fa],
      [rb, tb], [bohrer, tb], [tb, bohrer], [tb, fb], [fa, tm], [fb, tm], [monteur, tm], [tm, monteur], [tm, prod],
      [prod, tok], [prod, tn_], [tok, gut], [tn_, schrott]].forEach(([a, b]) => addA(a, b));
  },
  multicore() {
    description = 'Mehrkern-Rechner: Ein Auftrag wird auf vier parallele Rechenprozesse aufgeteilt. Nachdem alle vier Teilergebnisse vorliegen, werden sie zu einem Ergebnis zusammengeführt.';
    const setPlaceLabelAbove = id => { node(id).off = { name: [0, -69] }; };
    const setTransitionLabelAbove = id => { node(id).off = { name: [0, -73] }; };
    const p0 = addP('p₀', 60, 330, { m0: 1 });
    const split = addT('', 190, 330, { span: 140 });
    const merge = addT('', 500, 330, { span: 140 });
    node(split).hideName = true;
    node(merge).hideName = true;
    const subscripts = ['₁', '₂', '₃', '₄'];
    const rows = [215, 290, 365, 440].map((y, index) => {
      const subscript = subscripts[index];
      const left = addP(`p${subscript}₁`, 270, y);
      const work = addT(`t${subscript}`, 340, y);
      const right = addP(`p${subscript}₂`, 420, y);
      setPlaceLabelAbove(left);
      setTransitionLabelAbove(work);
      setPlaceLabelAbove(right);
      return { left, work, right };
    });
    const p5 = addP('p₅', 630, 330);
    setPlaceLabelAbove(p0);
    setPlaceLabelAbove(p5);
    addA(p0, split);
    rows.forEach(({ left, work, right }) => {
      addA(split, left); addA(left, work); addA(work, right); addA(right, merge);
    });
    addA(merge, p5);
    addComment('→  Parallele Verzweigung zur „Aufspaltung“ in parallele Pfade', 585, 185, '#d6002a', { size: 18 });
    addComment('→  Parallele Vereinigung zur „Fusion“ paralleler Pfade', 585, 240, '#d6002a', { size: 18 });
    addComment('→  Die Modellierung von parallelen Prozessen', 590, 435, '#d6002a', { size: 18 });
    addComment('ist mit Petrinetzen leicht möglich', 630, 460, '#d6002a', { size: 18 });
  },
  philosophers() {
    description = 'Dining Philosophers: 5 Philosophen sitzen am Tisch, zwischen je zwei liegt eine Gabel. Zum Essen braucht ein Philosoph beide Nachbargabeln; benachbarte Philosophen können daher nie gleichzeitig essen.';
    const N = 5;
    // [x, y, Beschriftung x, Beschriftung y] je Element
    const think = [[490, 72, 466, 25], [856, 236, 917, 197], [718, 636, 771, 668], [174, 631, 176, 667], [106, 257, 86, 215]];
    const eat = [[490, 198, 497, 155], [713, 297, 775, 270], [640, 547, 673, 586], [321, 552, 290, 599], [248, 306, 215, 267]];
    const fk = [[426, 279, 437, 315], [549, 280, 556, 315], [584, 405, 548, 373], [490, 480, 475, 444], [386, 392, 434, 365]];
    const take = [[342, 144, 312, 97], [740, 185, 768, 145], [752, 493, 824, 483], [407, 670, 406, 707], [72, 415, 71, 453]];
    const rel = [[589, 134, 640, 115], [790, 376, 777, 413], [555, 670, 557, 719], [230, 503, 160, 509], [272, 205, 214, 186]];
    const place = (name, [x, y, lx, ly], m0) => { const id = addP(name, x, y, { m0 }); node(id).off = { name: [lx - x, ly + 4 - (y + R + 15)] }; return id; };
    const trans = (name, [x, y, lx, ly]) => { const id = addT(name, x, y); node(id).off = { name: [lx - x, ly + 4 - (y + TL + 16)] }; return id; };
    const fork = fk.map((c, j) => place(`Gabel ${j + 1}`, c, 1));
    for (let i = 0; i < N; i++) {
      const n = i + 1;
      const th = place(`Philosoph ${n} denkt`, think[i], 1);
      const tk = trans(`${n} nimmt Gabeln`, take[i]);
      const ea = place(`Philosoph ${n} isst`, eat[i], 0);
      const rl = trans(`${n} legt Gabeln ab`, rel[i]);
      const f1 = fork[i], f2 = fork[(i + 1) % N];
      [[th, tk], [f1, tk], [f2, tk], [tk, ea], [ea, rl], [rl, th], [rl, f1], [rl, f2]].forEach(([a, b]) => addA(a, b));
    }
  },
  firingRules() {
    description = 'Schaltregel-Vergleich: P3 ist zugleich Vor- und Nachbereich von T1 und bereits markiert. Nach der starken Schaltregel ist T1 deshalb nicht aktiviert; nach der schwachen Schaltregel genügt die Markierung des Vorbereichs und T1 ist aktiviert.';
    addComment('Starke Schaltregel: Vor- und Nachbereich werden geprüft.', 210, 50, '#999999', { size: 22 });
    addComment('Schwache Schaltregel: Nur der Vorbereich wird geprüft.', 210, 105, '#c5c5c5', { size: 22 });
    const p1 = addP('P1', 80, 120);
    const p2 = addP('P2', 80, 320, { m0: 1 });
    const t1 = addT('T1', 280, 220);
    const p3 = addP('P3', 540, 220, { m0: 1 });
    [[p2, t1], [p3, t1], [t1, p1], [t1, p3]].forEach(([from, to]) => addA(from, to));
  },
  airport() {
    description = 'Flugplatz (S/T-Netz) mit zwei Rollbahnen (Rollbahn frei: k = 2, 2 Marken) und Warteschleife für maximal 5 Flugzeuge.';
    const setLabelOffset = (id, part, x, y) => {
      const item = node(id);
      item.off = item.off || {};
      item.off[part] = [x, y];
    };
    const warte = addP('Flugzeug in Warteschleife', 246, 50, { cap: 5 });
    const tOut = addT('aus Warteschleife', 166, 120, { h: true });
    const tIn = addT('in Warteschleife', 326, 120, { h: true });
    const srcL = addT('Anflug', 146, 190);
    const will = addP('Flugzeug will landen', 246, 190);
    const bahn = addP('Rollbahn frei', 246, 350, { cap: 2, m0: 2 });
    const tL1 = addT('Landung', 406, 240);
    const landet = addP('Flugzeug landet', 506, 240, { cap: 2 });
    const tL2 = addT('Landung beendet', 606, 240);
    const srcS = addT('Startwunsch', 146, 530);
    const wills = addP('Flugzeug will starten', 246, 530);
    const tS1 = addT('Start', 406, 460);
    const startet = addP('Flugzeug startet', 506, 460, { cap: 2 });
    const tS2 = addT('Start beendet', 606, 460);
    setLabelOffset(warte, 'name', -92, -56);
    setLabelOffset(tOut, 'name', -91, -23);
    setLabelOffset(tIn, 'name', 84, -20);
    setLabelOffset(bahn, 'cap', -68, -9);
    setLabelOffset(tL1, 'name', 0, -90);
    setLabelOffset(landet, 'name', 0, -80);
    setLabelOffset(tL2, 'name', 69, -38);
    setLabelOffset(tS1, 'name', 0, -80);
    setLabelOffset(startet, 'cap', -69, 0);
    setLabelOffset(tS2, 'name', 60, -42);
    [[will, tIn], [tIn, warte], [warte, tOut], [tOut, will], [srcL, will], [will, tL1], [bahn, tL1], [tL1, landet], [landet, tL2], [tL2, bahn],
      [srcS, wills], [wills, tS1], [bahn, tS1], [tS1, startet], [startet, tS2], [tS2, bahn]].forEach(([a, b]) => addA(a, b));
  }
};
function loadExample(key) {
  if (!EXAMPLES[key]) return;
  newNet(); EXAMPLES[key]();
  pn = net.places.length; tn = net.transitions.length;
  resetSim(); setMode('sim');
}

/* ---------- Speichern ---------- */
const STORE = 'petriNets';
const readStore = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
function refreshSaved(selected = '') {
  const names = Object.keys(readStore()).sort();
  $('saved').innerHTML = '<option value="">– auswählen –</option>' + names.map(n => `<option${n === selected ? ' selected' : ''}>${esc(n)}</option>`).join('');
}
function saveNet() {
  const name = (prompt('Name des Netzes:', $('saved').value || '') || '').trim();
  if (!name) return;
  const store = readStore();
  if (store[name] && !confirm(`„${name}" überschreiben?`)) return;
  store[name] = { net, description };
  localStorage.setItem(STORE, JSON.stringify(store));
  refreshSaved(name); setStatus(`Netz „${name}" gespeichert.`);
}
function loadSaved(name) {
  const d = readStore()[name];
  if (!d) return;
  net = d.net; description = d.description || ''; sel = null; arcFrom = null; multi.clear();
  net.comments = net.comments || [];
  const ids = [...net.places, ...net.transitions, ...net.arcs].map(o => parseInt(o.id.slice(1)) || 0);
  counter = Math.max(0, ...ids); pn = net.places.length; tn = net.transitions.length;
  $('example').value = '';
  changed();
}
function deleteSaved() {
  const name = $('saved').value;
  if (!name || !confirm(`„${name}" löschen?`)) return;
  const store = readStore(); delete store[name];
  localStorage.setItem(STORE, JSON.stringify(store)); refreshSaved();
}

/* ---------- Darstellung ---------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('petriNet:theme', t); } catch { /* ohne Speicher */ }
  $('btn-theme').textContent = t === 'dark' ? '☀' : '☾';
  $('btn-theme').title = t === 'dark' ? 'Helle Darstellung' : 'Dunkle Darstellung (Dark Mode)';
  readColors(); render();
}

// Datum der letzten Änderung: jüngster Zeitstempel von Seite, Skripten und Stylesheets (Server-Header „Last-Modified“);
// ohne Webserver (file://) gilt das Änderungsdatum der HTML-Datei
function showLastModified() {
  const set = t => document.querySelectorAll('.last-modified').forEach(e => { e.textContent = new Date(t).toLocaleDateString('de-DE'); });
  set(Date.parse(document.lastModified) || Date.now());
  if (!location.protocol.startsWith('http')) return;
  const urls = [location.href, ...[...document.scripts].map(s => s.src), ...[...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href)]
    .filter(u => u && new URL(u).origin === location.origin);
  Promise.all(urls.map(u => fetch(u, { method: 'HEAD', cache: 'no-store' }).then(r => Date.parse(r.headers.get('Last-Modified')) || 0, () => 0)))
    .then(ts => { const t = Math.max(...ts); if (t) set(t); });
}

/* ---------- Demo-Modus: Vollbild, Flugplatz im Auto-Lauf ---------- */
function startDemo() {
  if (demo) return;
  demo = { net: JSON.stringify(net), description, counter, pn, tn, example: $('example').value, mode, speed: $('speed').value, rule: firingRule, fs: false, paused: false };
  if (document.activeElement) document.activeElement.blur(); // Leertaste soll nicht den Demo-Button auslösen
  document.body.classList.add('demo');
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().then(() => { if (demo) demo.fs = true; }, () => {});
  }
  $('example').value = 'airport';
  firingRule = 'strong'; $('firing-rule').value = 'strong';
  $('speed').value = '1';
  loadExample('airport');
  setAuto(true);
  updateDemoCtrl();
  requestAnimationFrame(fitNetToViewport);
}
// Tempo (Auswahl der Werkzeugleiste) und Anhalten im Demo-Modus
function stepDemoSpeed(step) {
  const s = $('speed');
  s.selectedIndex = Math.max(0, Math.min(s.options.length - 1, s.selectedIndex + step));
  updateDemoCtrl();
}
function toggleDemoPause() {
  demo.paused = !demo.paused;
  updateDemoCtrl();
}
function updateDemoCtrl() {
  const s = $('speed');
  $('demo-speed').textContent = s.selectedOptions[0].textContent;
  $('demo-slower').disabled = s.selectedIndex === 0;
  $('demo-faster').disabled = s.selectedIndex === s.options.length - 1;
  $('demo-pause').textContent = demo.paused ? '▶ Weiter' : '❚❚ Anhalten';
  $('demo-pause').classList.toggle('active', demo.paused);
}
function stopDemo() {
  const d = demo;
  if (!d) return;
  demo = null;
  for (const id in flash) delete flash[id];
  document.body.classList.remove('demo');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  net = JSON.parse(d.net); description = d.description; counter = d.counter; pn = d.pn; tn = d.tn;
  sel = null; arcFrom = null; multi.clear();
  $('example').value = d.example; $('speed').value = d.speed;
  firingRule = d.rule; $('firing-rule').value = d.rule;
  zoom = 1; svg.setAttribute('width', VW); svg.setAttribute('height', VH);
  svg.style.marginLeft = svg.style.marginTop = '0';
  resetSim(); setMode(d.mode);
}
document.addEventListener('fullscreenchange', () => {
  if (!demo) return;
  if (!document.fullscreenElement && demo.fs) stopDemo();
  else requestAnimationFrame(fitNetToViewport);
});
window.addEventListener('resize', () => { if (demo) requestAnimationFrame(fitNetToViewport); });

/* ---------- Export ---------- */
function exportCsv() {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Schritt', 'Zeit', 'Ereignis', ...net.places.map(p => p.name)].map(q).join(';')];
  rows.push([0, 0, 'Anfangsmarkierung', ...net.places.map(p => p.m0)].map((v, i) => i === 2 ? q(v) : v).join(';'));
  log.forEach(e => rows.push([e.step, e.time, q(e.text), ...net.places.map(p => e.m[p.id])].join(';')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv' }));
  a.download = 'petri-verlauf.csv'; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- Init ---------- */
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('[data-pattern]').forEach(b => b.addEventListener('click', () => addPattern(b.dataset.pattern)));
$('mode-edit').addEventListener('click', () => setMode('edit'));
$('mode-sim').addEventListener('click', () => setMode('sim'));
$('btn-reset').addEventListener('click', () => { setAuto(false); resetSim(); render(); });
$('btn-undo').addEventListener('click', undo);
$('btn-auto').addEventListener('click', () => setAuto(!auto));
$('firing-rule').addEventListener('change', e => {
  firingRule = e.target.value;
  setStatus(`Schaltregel: ${firingRule === 'strong' ? 'stark' : 'schwach'}.`);
  render();
});
$('btn-rotate').addEventListener('click', rotateSelectedTransitions);
$('btn-csv').addEventListener('click', exportCsv);
$('btn-save').addEventListener('click', saveNet);
$('btn-delsaved').addEventListener('click', deleteSaved);
$('saved').addEventListener('change', e => loadSaved(e.target.value));
refreshSaved();
document.querySelectorAll('.version').forEach(e => { e.textContent = VERSION; });
showLastModified();
$('btn-theme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('btn-demo').addEventListener('click', startDemo);
$('btn-demo-exit').addEventListener('click', stopDemo);
$('demo-slower').addEventListener('click', () => stepDemoSpeed(-1));
$('demo-faster').addEventListener('click', () => stepDemoSpeed(1));
$('demo-pause').addEventListener('click', toggleDemoPause);
$('example').addEventListener('change', e => { loadExample(e.target.value); });
$('btn-new').addEventListener('click', () => {
  if (net.places.length + net.transitions.length && !confirm('Aktuelles Netz verwerfen?')) return;
  newNet(); $('example').value = ''; setMode('edit'); resetSim(); render();
});

newNet(); resetSim();
setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
setTool('select');
setInterval(tick, 100);
