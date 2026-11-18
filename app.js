// Blunderprint app. Built from tools/parts/*.js by tools/build.py; edit the parts, not site/app.js.
import * as C from './core.js';
import * as SY from './sync.js';
const { Chess } = C;

/* ---------- tiny helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1);
const mmss = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); };
const clockText = s => s < 20 ? mmss(s) + '.' + Math.floor((Math.max(0, s) % 1) * 10) : mmss(s);
const MINUS = '−';
const signed = (v, d = 1) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(d);
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const usDate = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[2]}/${+m[3]}/${m[1]}` : (d || '?'); };
const shortDate = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[2]}/${+m[3]}` : '?'; };
const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();
const SPEED_NAME = { ultrabullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', other: '' };

const ls = {
  get(k, d) { try { const v = localStorage.getItem('bp:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bp:' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('bp:' + k); } catch (e) {} },
};
// Per-profile keys live under bp:<profile id>:<key>.
const pls = {
  get(k, d) { return st.pid ? ls.get(st.pid + ':' + k, d) : d; },
  set(k, v) { if (st.pid) ls.set(st.pid + ':' + k, v); },
};
const idb = {
  db: null,
  open() {
    return new Promise(res => {
      try {
        const r = indexedDB.open('blunderprint', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(true); };
        r.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  },
  get(k) { return new Promise(res => { if (!this.db) return res(undefined); try { const r = this.db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); } catch (e) { res(undefined); } }); },
  set(k, v) { return new Promise(res => { if (!this.db) return res(false); try { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); } catch (e) { res(false); } }); },
  del(k) { return new Promise(res => { if (!this.db) return res(false); try { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(true); t.onerror = () => res(false); } catch (e) { res(false); } }); },
};

/* ---------- eval text ---------- */
// e is relative to the side to move. Returns text from `pov`'s side ('w' or 'b').
function evalFor(e, stm, pov) {
  if (!e) return '';
  const flip = stm === pov ? 1 : -1;
  if (e.terminal || e.over) return e.mate != null ? (flip * (e.mate || -1) > 0 ? 'Mate' : 'Mated') : '0.0';
  if (e.mate != null) { const v = flip * e.mate; return (v > 0 ? '+M' : MINUS + 'M') + Math.abs(e.mate); }
  return signed(flip * (e.cp || 0) / 100);
}

/* ---------- board ---------- */
const FILES = 'abcdefgh';
class Board {
  constructor(root) {
    this.root = root; root.classList.add('board');
    this.orient = 'w'; this.chess = new Chess(); this.movable = false; this.sel = null; this.targets = new Map();
    this.last = null; this.arrow = null; this.onMove = null; this.drag = null;
    root.addEventListener('pointerdown', e => this.down(e));
    root.addEventListener('pointermove', e => this.move(e));
    root.addEventListener('pointerup', e => this.up(e));
    root.addEventListener('pointercancel', () => { this.drag = null; this.render(); });
    this.render();
  }
  set(fen, o = {}) {
    this.chess = new Chess(fen);
    if (o.orient) this.orient = o.orient;
    this.movable = o.movable ?? false;
    this.last = o.last ?? null; this.arrow = o.arrow ?? null; this.sel = null; this.targets = new Map(); this.drag = null;
    this.root.classList.toggle('off', !!o.dim);
    this.render();
  }
  sqAt(r, f) { return this.orient === 'w' ? FILES[f] + (8 - r) : FILES[7 - f] + (r + 1); }
  xy(sq) { const f = FILES.indexOf(sq[0]), r = +sq[1]; return this.orient === 'w' ? [f + .5, 8 - r + .5] : [7 - f + .5, r - 1 + .5]; }
  render() {
    const c = this.chess; let html = '';
    let kingSq = null;
    if (c.isCheck()) for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === c.turn()) kingSq = p.square;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const sq = this.sqAt(r, f), p = c.get(sq);
      const dark = (FILES.indexOf(sq[0]) + +sq[1]) % 2 === 1;
      let cls = 'sq ' + (dark ? 'd' : 'l');
      if (this.last && (this.last[0] === sq || this.last[1] === sq)) cls += ' last';
      if (this.sel === sq) cls += ' sel';
      if (this.targets.has(sq)) cls += ' tgt' + (p ? ' occ' : '');
      if (kingSq === sq) cls += ' chk';
      html += `<div class="${cls}" data-sq="${sq}">` +
        (f === 0 ? `<span class="co r">${sq[1]}</span>` : '') + (r === 7 ? `<span class="co f">${sq[0]}</span>` : '') +
        (p ? `<svg class="pc" viewBox="0 0 40 40"><use href="#${p.color}${p.type}"/></svg>` : '') + '</div>';
    }
    if (this.arrow) {
      const [x1, y1] = this.xy(this.arrow[0]), [x2, y2] = this.xy(this.arrow[1]);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const ex = x2 - ux * .32, ey = y2 - uy * .32, px = -uy, py = ux;
      html += `<svg class="arrow" viewBox="0 0 8 8"><line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="#f2a33a" stroke-width=".2" stroke-linecap="round" opacity=".9"/><polygon points="${x2 - ux * .05},${y2 - uy * .05} ${ex + px * .26},${ey + py * .26} ${ex - px * .26},${ey - py * .26}" fill="#f2a33a" opacity=".95"/></svg>`;
    }
    this.root.innerHTML = html;
  }
  select(sq) {
    this.sel = sq; this.targets = new Map();
    if (sq) for (const m of this.chess.moves({ square: sq, verbose: true })) this.targets.set(m.to, m);
  }
  canPick(sq) { const p = this.chess.get(sq); return this.movable && p && p.color === this.chess.turn() && (this.movable === true || this.movable === p.color); }
  down(e) {
    const el = e.target.closest('.sq'); if (!el) return;
    const sq = el.dataset.sq;
    if (this.sel && this.targets.has(sq)) { e.preventDefault(); return this.attempt(this.sel, sq); }
    if (this.canPick(sq)) {
      e.preventDefault();
      this.select(sq); this.render();
      const pc = this.root.querySelector(`[data-sq="${sq}"] .pc`);
      this.drag = { from: sq, pc, x: e.clientX, y: e.clientY, moved: false };
      try { this.root.setPointerCapture(e.pointerId); } catch (err) {}
    } else if (this.sel) { this.select(null); this.render(); }
  }
  move(e) {
    const d = this.drag; if (!d || !d.pc) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true; d.pc.classList.add('drag'); d.pc.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  up(e) {
    const d = this.drag; if (!d) return;
    this.drag = null;
    if (!d.moved) return;
    const rect = this.root.getBoundingClientRect();
    const f = Math.floor((e.clientX - rect.left) / (rect.width / 8)), r = Math.floor((e.clientY - rect.top) / (rect.height / 8));
    if (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = this.sqAt(r, f);
      if (this.targets.has(sq)) return this.attempt(d.from, sq);
    }
    this.render();
  }
  attempt(from, to) {
    const m = this.targets.get(to);
    this.select(null);
    const promo = m && m.promotion ? 'q' : undefined;
    if (this.onMove) this.onMove({ from, to, promotion: promo }); else this.render();
  }
}

/* ---------- stage: a board you can explore, step through and reset ---------- */
const stages = [];
const moveNo = ply => Math.floor(ply / 2) + 1 + (ply % 2 === 0 ? '. ' : '… ');
class Stage {
  constructor(root, o = {}) {
    this.o = o; this.root = root; root.classList.add('stg');
    root.innerHTML = `<div class="stage-row"><div class="evalbar" title="Engine evaluation"><i></i><b></b></div><div class="bd"></div></div>
      <div class="navrow">
        <button class="btn quiet nb" type="button" data-a="first" aria-label="Go to the first move">«</button>
        <button class="btn quiet nb" type="button" data-a="prev" aria-label="One move back">‹</button>
        <button class="btn quiet nb" type="button" data-a="next" aria-label="One move forward">›</button>
        <button class="btn quiet nb" type="button" data-a="last" aria-label="Go to the last move">»</button>
        <button class="btn" type="button" data-a="reset">${esc(o.resetLabel || 'Reset')}</button>
        <button class="btn quiet" type="button" data-a="hint">Hint</button>
      </div>
      <div class="poslabel"></div><div class="graph"></div>`;
    this.board = new Board(root.querySelector('.bd'));
    this.bar = root.querySelector('.evalbar'); this.barLab = this.bar.querySelector('b');
    this.label = root.querySelector('.poslabel'); this.graph = root.querySelector('.graph');
    this.main = { fens: [new Chess().fen()], moves: [], evals: null, anchor: 0, marks: [], userColor: 'w', offset: 0 };
    this.idx = 0; this.vari = []; this.orient = 'w'; this.mode = 'idle'; this.quiet = true; this.arrow = null; this.tok = 0; this.cache = null;
    this.board.onMove = m => this.userMove(m);
    root.querySelector('.navrow').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && !b.disabled) this.act(b.dataset.a); });
    this.graph.addEventListener('click', e => {
      const svg = this.graph.querySelector('svg'); if (!svg || this.quiet) return;
      const r = svg.getBoundingClientRect(), n = this.main.fens.length;
      this.goto(Math.round((e.clientX - r.left) / r.width * (n - 1)));
    });
    stages.push(this); this.idle();
  }
  fen() { return this.vari.length ? this.vari[this.vari.length - 1].fen : this.main.fens[this.idx]; }
  idle() { this.mode = 'idle'; this.quiet = true; this.vari = []; this.arrow = null; this.board.set(new Chess().fen(), { dim: true }); this.ui(); }
  live(fen, o) { this.mode = 'live'; this.quiet = true; this.orient = o.orient; this.board.set(fen, o); this.ui(); }
  setGame(g) {
    this.main = { marks: [], offset: 0, evals: null, ...g };
    this.orient = g.orient; this.idx = g.anchor; this.vari = []; this.arrow = null; this.mode = 'explore'; this.quiet = !!g.quiet; this.show();
  }
  setEvals(evals, marks) { this.main.evals = evals; if (marks) this.main.marks = marks; if (this.mode === 'explore') { this.ui(); this.evalNow(); } }
  goto(i) { this.vari = []; this.arrow = null; this.idx = Math.max(0, Math.min(this.main.fens.length - 1, i)); this.show(); }
  show() {
    const fen = this.fen(); let last = null;
    if (this.vari.length) { const v = this.vari[this.vari.length - 1]; last = [v.mv.from, v.mv.to]; }
    else if (this.idx > 0 && this.main.moves[this.idx - 1]) { const m = this.main.moves[this.idx - 1]; last = [m.from, m.to]; }
    this.board.set(fen, { orient: this.orient, movable: true, last, arrow: this.arrow });
    this.ui(); this.evalNow();
    if (this.o.onShow) this.o.onShow(this);
  }
  ui() {
    const q = this.quiet || this.mode !== 'explore', m = this.main, atStart = this.idx === 0 && !this.vari.length, atEnd = this.vari.length > 0 || this.idx >= m.fens.length - 1;
    this.root.classList.toggle('quiet', q);
    const set = (a, dis) => { this.root.querySelector(`[data-a="${a}"]`).disabled = dis; };
    set('first', q || atStart); set('prev', q || atStart); set('next', q || atEnd); set('last', q || atEnd); set('hint', q);
    set('reset', q || (this.o.resetMode === 'branch' ? !this.vari.length : (!this.vari.length && this.idx === m.anchor && !this.arrow)));
    if (q) { this.label.textContent = ''; }
    else if (this.vari.length) {
      const base = m.offset + this.idx;
      this.label.innerHTML = 'Your line: <b>' + this.vari.map((v, i) => (i === 0 || (base + i) % 2 === 0 ? moveNo(base + i) : '') + esc(v.mv.san)).join(' ') + '</b>';
    } else {
      const ply = m.offset + this.idx, mv = m.moves[this.idx - 1];
      let t = mv ? `After ${moveNo(ply - 1)}<b>${esc(mv.san)}</b>` : (m.offset ? 'Starting position' : 'Start of the game');
      if (m.anchorNote && this.idx === m.anchor) t += ' · ' + m.anchorNote;
      else if (m.anchorNote && this.idx > m.anchor) t += ' · what happened in the game';
      else if (m.anchorNote && this.idx < m.anchor) t += ` · ${plural(Math.ceil((m.anchor - this.idx) / 2), 'move')} earlier`;
      this.label.innerHTML = t;
    }
    this.drawGraph();
  }
  setBar(e, fen) {
    const stm = fen.split(' ')[1], w = C.winPct(e), white = stm === 'w' ? w : 100 - w;
    const i = this.bar.querySelector('i');
    i.style.height = white.toFixed(1) + '%';
    i.style.top = this.orient === 'w' ? 'auto' : '0'; i.style.bottom = this.orient === 'w' ? '0' : 'auto';
    // Score at the leading side's end of the bar, like the big chess sites.
    let txt, whiteLeads;
    if (e.terminal || e.over) { const loserIsStm = e.mate != null; whiteLeads = loserIsStm ? stm === 'b' : true; txt = e.mate != null ? (whiteLeads ? '1-0' : '0-1') : '½'; }
    else if (e.mate != null) { whiteLeads = (e.mate > 0) === (stm === 'w'); txt = 'M' + Math.abs(e.mate); }
    else { const cp = (stm === 'w' ? e.cp : -e.cp) / 100; whiteLeads = cp >= 0; const a = Math.abs(cp); txt = (a >= 10 ? a.toFixed(0) : a.toFixed(1)); }
    if (!(e.terminal || e.over)) txt = (whiteLeads ? '+' : MINUS) + txt;
    const atBottom = whiteLeads === (this.orient === 'w');
    this.barLab.textContent = txt;
    this.barLab.className = (whiteLeads ? 'onw ' : 'onb ') + (atBottom ? 'bot' : 'top');
    this.bar.title = 'Engine evaluation: ' + txt + (whiteLeads ? ' for White' : ' for Black');
    this.lastEval = { e, fen };
  }
  stored() { return !this.vari.length && this.main.evals ? this.main.evals[this.idx] : null; }
  evalNow() {
    const tok = ++this.tok;
    if (this.quiet || this.mode !== 'explore') return;
    const fen = this.fen(), s = this.stored();
    if (s) return this.setBar(s, fen);
    const t = C.terminalEval(fen);
    if (t) return this.setBar(t.lost ? { mate: -1, cp: null, over: true } : { cp: 0, mate: null, over: true }, fen);
    if (this.cache && this.cache.fen === fen) return this.setBar(this.cache.e, fen);
    if (!st.engI) { this.barLab.textContent = ''; return; }
    this.barLab.textContent = '…';
    setTimeout(async () => {
      if (tok !== this.tok) return;
      const e = await st.engI.analyse(fen, st.depth);
      this.cache = { fen, e };
      if (tok === this.tok) this.setBar(e, fen);
    }, 140);
  }
  async hint() {
    const fen = this.fen();
    let e = this.stored() || (this.cache && this.cache.fen === fen ? this.cache.e : null);
    if ((!e || !e.best) && st.engI && !C.terminalEval(fen)) { e = await st.engI.analyse(fen, st.depth); this.cache = { fen, e }; }
    if (!e || !e.best || this.fen() !== fen) return;
    this.arrow = [e.best.slice(0, 2), e.best.slice(2, 4)];
    this.show();
    if (this.o.onHint) this.o.onHint(e, fen);
  }
  userMove(m) {
    if (this.mode === 'live') return this.o.onLiveMove ? this.o.onLiveMove(m) : this.board.render();
    if (this.mode !== 'explore') return this.board.render();
    const before = this.fen(), c = new Chess(before); let mv;
    try { mv = c.move(m); } catch (e) { return this.board.render(); }
    const first = !this.vari.length && this.idx === this.main.anchor;
    this.vari.push({ fen: c.fen(), mv }); this.arrow = null; this.show();
    if (this.o.onMove) this.o.onMove({ first, before, after: c.fen(), mv });
  }
  act(a) {
    if (a === 'hint') return this.hint();
    const n = this.main.fens.length;
    if (a === 'first') { this.vari = []; this.idx = 0; }
    else if (a === 'prev') { if (this.vari.length) this.vari.pop(); else this.idx = Math.max(0, this.idx - 1); }
    else if (a === 'next') { if (!this.vari.length) this.idx = Math.min(n - 1, this.idx + 1); }
    else if (a === 'last') { this.vari = []; this.idx = n - 1; }
    else if (a === 'reset') { this.vari = []; if (this.o.resetMode !== 'branch') this.idx = this.main.anchor; }
    this.arrow = null; this.show();
    if (this.o.onNav) this.o.onNav(a);
  }
  drawGraph() {
    const m = this.main, ev = m.evals;
    if (this.mode !== 'explore' || this.quiet || !ev || m.fens.length < 4) { this.graph.innerHTML = ''; return; }
    const n = Math.min(ev.length, m.fens.length), W = 500, H = 66, P = 4;
    if (n < 2) { this.graph.innerHTML = ''; return; }
    const val = i => { const w = C.winPct(ev[i]); return m.fens[i].split(' ')[1] === m.userColor ? w : 100 - w; };
    const x = i => P + (W - 2 * P) * i / (n - 1), y = v => P + (H - 2 * P) * (1 - v / 100);
    let d = '';
    for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val(i)).toFixed(1);
    const area = d + `L${x(n - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z`;
    const marks = (m.marks || []).filter(p => p + 1 < n).map(p => `<circle cx="${x(p + 1).toFixed(1)}" cy="${y(val(p + 1)).toFixed(1)}" r="3.2" fill="#f0503c"/>`).join('');
    const cur = Math.min(this.idx, n - 1);
    const anchorLine = m.anchor > 0 ? `<line x1="${x(Math.min(m.anchor, n - 1))}" x2="${x(Math.min(m.anchor, n - 1))}" y1="0" y2="${H}" stroke="#f2a33a" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>` : '';
    this.graph.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Your win chance across the game. Red dots are your mistakes. Click to jump to a move.">
      <path d="${area}" fill="rgba(129,182,76,.2)"/><line x1="${P}" x2="${W - P}" y1="${y(50)}" y2="${y(50)}" stroke="#4a4845" stroke-dasharray="3 3"/>
      <path d="${d}" fill="none" stroke="#81b64c" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${anchorLine}${marks}<line x1="${x(cur)}" x2="${x(cur)}" y1="0" y2="${H}" stroke="#ffffff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
      <div class="graphcap">Your win chance. Red dots are your mistakes. Tap to jump there.</div>`;
  }
}
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const s = stages.find(s => s.root.offsetParent !== null && s.mode === 'explore' && !s.quiet);
  if (!s) return;
  e.preventDefault(); s.act(e.key === 'ArrowLeft' ? 'prev' : 'next');
});
const badPlies = recs => (recs || []).filter(x => x.sev === 'blunder' || x.sev === 'mistake').map(x => x.ply);

function pvSan(fen, pv, max = 4) {
  const c = new Chess(fen), out = [];
  for (const u of (pv || []).slice(0, max)) {
    try { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); if (!m) break; out.push(m.san); } catch (e) { break; }
  }
  return out;
}
function sanOf(fen, uci) { return pvSan(fen, [uci], 1)[0] || uci; }

/* ---------- shared bits for info cards ---------- */
function oppOf(g, col) { return col === 'w' ? { name: g.black, elo: g.blackElo } : { name: g.white, elo: g.whiteElo }; }
function meElo(g, col) { return col === 'w' ? g.whiteElo : g.blackElo; }
function gameLink(g, ply, col) {
  if (!g.site) return '';
  if (g.platform === 'lichess') return g.site + (col === 'b' ? '/black' : '') + (ply != null ? '#' + ply : '');
  return g.site;
}
const platLabel = g => g.platform === 'chesscom' ? 'Chess.com' : 'Lichess';
// The info card shown beside a mistake position. `reveal` decides whether the best move is shown.
function infoCard(r, reveal) {
  const g = st.byId[r.gid]; if (!g) return '';
  const col = r.fen.split(' ')[1], opp = oppOf(g, col), ev = st.evals[g.id] || [];
  const before = ev[r.ply], after = ev[r.ply + 1];
  const swing = before && after ? `${evalFor(before, col, col)} → ${evalFor(after, col === 'w' ? 'b' : 'w', col)}` : '';
  const sev = r.sev ? `<span class="sev ${r.sev}">${r.sev}</span>` : '';
  const best = reveal ? esc(sanOf(r.fen, r.best)) : '<span class="hide">Solve it or tap Show answer</span>';
  const clock = r.spent != null ? `${mmss(r.left)} left · thought ${Math.round(r.spent)}s` : 'No clock data';
  const link = gameLink(g, r.ply, col);
  const rows = [
    ['Piece moved', C.PIECE_NAME[r.piece]],
    ['You played', `${esc(r.san)} ${sev}`],
    ['Eval for you', swing ? `<span class="mono">${swing}</span>` : '–'],
    ['Mistake type', r.cat ? esc(C.CATS[r.cat].label) : '–'],
    ['Best move', best],
    ['Date', usDate(g.date)],
    ['Opponent', `${esc(opp.name)}${opp.elo ? ' (' + opp.elo + ')' : ''}`],
    ['You', `${col === 'w' ? 'White' : 'Black'}${meElo(g, col) ? ' · ' + meElo(g, col) : ''}`],
    ['Time control', `${esc(g.tcLabel)}${SPEED_NAME[g.speed] ? ' · ' + SPEED_NAME[g.speed] : ''}`],
    ['Move', `${Math.floor(r.ply / 2) + 1} · ${C.PHASES[r.phase]}`],
    ['Clock', clock],
    ['Result', esc(C.resultText(g, col))],
  ];
  if (link) rows.push(['Game', `<a href="${esc(link)}" target="_blank" rel="noopener">Open on ${platLabel(g)} ↗</a>`]);
  return rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}


/* ---------- engines ---------- */
const ENGINE_TRIES = [
  { url: './stockfish-19-lite-single.js', label: 'Stockfish 19', slow: false, blob: false },
  { url: './stockfish-19-asm.js', label: 'Stockfish 19, slow mode', slow: true, blob: false },
  { url: './stockfish-19-asm.js', label: 'Stockfish 19, slow mode', slow: true, blob: true },
];
let engineKind = null;
async function spawnEngine(t) {
  let w;
  try {
    if (t.blob) { const txt = await (await fetch(t.url)).text(); w = new Worker(URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }))); }
    else w = new Worker(t.url);
    const eng = new C.Engine(s => w.postMessage(s));
    w.onmessage = e => eng.feed(e.data);
    const ok = await Promise.race([
      eng.start(),
      new Promise(res => setTimeout(() => res(false), 15000)),
      new Promise(res => { w.onerror = () => res(false); }),
    ]);
    if (!ok) { w.terminate(); return null; }
    const probe = await Promise.race([eng.analyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4), new Promise(res => setTimeout(() => res(null), 15000))]);
    if (!probe || !probe.best) { w.terminate(); return null; }
    return eng;
  } catch (e) { try { w && w.terminate(); } catch (x) {} return null; }
}
async function makeEngine() {
  const list = engineKind ? [engineKind] : ENGINE_TRIES;
  for (const t of list) { const e = await spawnEngine(t); if (e) { engineKind = t; return e; } }
  return null;
}

/* ---------- state ---------- */
const st = {
  profiles: [], pid: null, p: null,
  all: [], games: [], byId: {}, gameIdx: {}, user: '', tc: 'all', evals: {}, analysis: {}, S: null, book: {}, prog: {},
  target: 100, paused: false, running: false, epoch: 0, engA: null, engI: null, depth: 10, syncing: false,
  dirty: new Set(), trainMode: 'pz', alerted: false,
};
const DEFAULTS = { max: 300, target: 100, tc: 'all', lastTs: 0, lastSync: 0 };
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function saveProfiles() { ls.set('profiles', st.profiles); ls.set('active', st.pid); }

function refilter() {
  st.games = st.all.filter(g => C.userColor(g, st.user) && (st.tc === 'all' || g.tcLabel === st.tc));
  st.byId = {}; st.gameIdx = {};
  st.games.forEach((g, i) => { st.byId[g.id] = g; st.gameIdx[g.id] = i; });
  st.analysis = {};
  for (const g of st.games) if (st.evals[g.id]) st.analysis[g.id] = C.tagGame(g, st.evals[g.id], st.user);
  st.book = C.buildBook(st.games, st.user);
  recompute();
}
function recompute() {
  st.S = C.summarize(st.games, st.analysis, st.user);
  markDirty();
}
// Re-render only what is on screen; other tabs render when opened.
function markDirty() {
  for (const k of ['stats', 'improve', 'history']) st.dirty.add(k);
  renderVisible();
  updateProgress();
  pz.poke(); dr.poke(); ghRecord();
}
function renderVisible() {
  const t = currentTab();
  if (st.dirty.has(t)) {
    st.dirty.delete(t);
    if (t === 'stats') renderStats();
    else if (t === 'improve') renderImprove();
    else if (t === 'history') hv.renderList();
  }
}

/* ---------- profiles ---------- */
async function loadProfile(pid) {
  st.epoch++;
  gh.stop();
  const p = st.profiles.find(x => x.id === pid);
  if (!p) return;
  st.pid = pid; st.p = p; saveProfiles();
  st.user = p.username; st.tc = p.tc || 'all'; st.target = p.target || 100;
  const text = (await idb.get('pgn:' + pid)) || '';
  st.all = text ? C.parsePgn(text).filter(g => C.userColor(g, st.user)) : [];
  st.evals = (await idb.get('evals:' + pid)) || {};
  st.prog = pls.get('prog', {});
  renderHeader();
  refilter();
  pz.reset(); dr.reset(); hv.reset();
  const elo = st.S.medianRating; if (elo) { $('gh-elo').value = Math.round(elo / 50) * 50; $('gh-elo-val').textContent = $('gh-elo').value; }
  fillSettings();
  runAnalysis();
}

// Merge freshly downloaded PGN text into the profile. Returns how many games were new.
async function mergeGames(text) {
  const fresh = C.parsePgn(text).filter(g => C.userColor(g, st.user));
  const have = new Set(st.all.map(g => g.id));
  const added = fresh.filter(g => !have.has(g.id));
  if (!added.length && st.all.length) return 0;
  const all = st.all.concat(added).sort((a, b) => b.ts - a.ts).slice(0, st.p.max || 300);
  st.all = all;
  await idb.set('pgn:' + st.pid, all.map(g => g.raw).join('\n\n'));
  const ts = all.reduce((m, g) => Math.max(m, g.ts || 0), 0);
  if (ts) st.p.lastTs = Math.max(st.p.lastTs || 0, ts);
  saveProfiles();
  return added.length;
}

function syncNote(text, bad) { const el = $('sync-note'); el.textContent = text; el.classList.toggle('bad', !!bad); }
function showAlert(html) { const el = $('alert'); el.innerHTML = html; el.hidden = !html; }

function syncErrorText(e, p) {
  const site = SY.PLATFORMS[p.platform].label;
  if (e.kind === 'notfound') return `${site} has no player called "${esc(p.username)}".`;
  if (e.kind === 'network') return `Couldn't reach ${site} from this page. If it's open inside Claude, syncing is blocked there; open your own site instead, or add a games file in Settings.`;
  return `${site} had a problem (${esc(e.message)}). Try again in a minute.`;
}

async function syncProfile({ full = false, onProgress } = {}) {
  const p = st.p;
  if (!p || st.syncing) return null;
  if (!full && !navigator.onLine) { syncNote('Offline'); return null; }
  st.syncing = true; $('sync-btn').classList.add('spin'); syncNote('Syncing…');
  const pid = st.pid, epoch = st.epoch;
  try {
    const since = full ? 0 : (p.lastTs || 0);
    const text = await SY.fetchGames(p.platform, p.username, {
      since, max: since ? 500 : (p.max || 300),
      onProgress: n => { syncNote(`Downloading… ${n}`); if (onProgress) onProgress(n); },
    });
    if (st.pid !== pid || st.epoch !== epoch) return null;
    const added = await mergeGames(text);
    p.lastSync = Date.now(); saveProfiles();
    syncNote(added ? `${plural(added, 'new game')}` : 'Up to date');
    showAlert('');
    if (added) { refilter(); fillSettings(); runAnalysis(); }
    return added;
  } catch (e) {
    if (st.pid === pid) {
      syncNote('Sync failed', true);
      if (!st.alerted || e.kind !== 'network') { showAlert(`<span>${syncErrorText(e, p)}</span><a class="btn quiet" href="#settings">Settings</a>`); st.alerted = true; }
    }
    throw e;
  } finally {
    st.syncing = false; $('sync-btn').classList.remove('spin');
  }
}

/* ---------- header ---------- */
function renderHeader() {
  const p = st.p;
  $('p-av').textContent = p ? initial(p.name) : '?';
  $('p-name').textContent = p ? p.name : 'No profile';
  $('p-plat').textContent = p ? SY.PLATFORMS[p.platform].label : '';
  $('tabs').hidden = !p;
  const menu = $('p-menu');
  menu.innerHTML = st.profiles.map(x => `<button type="button" data-pid="${x.id}" class="${x.id === st.pid ? 'cur' : ''}"><span class="av">${esc(initial(x.name))}</span>${esc(x.name)}<small>${SY.PLATFORMS[x.platform].label}</small></button>`).join('') +
    (st.profiles.length ? '<hr>' : '') + `<a href="#setup">Add a profile</a><a href="#settings">Settings</a>`;
}
function initHeader() {
  const btn = $('p-btn'), menu = $('p-menu');
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); };
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.pmenu')) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  menu.addEventListener('click', async e => {
    const b = e.target.closest('[data-pid]');
    menu.hidden = true;
    if (!b) return;
    if (b.dataset.pid !== st.pid) { syncNote(''); showAlert(''); await loadProfile(b.dataset.pid); syncProfile().catch(() => {}); }
  });
  $('sync-btn').onclick = () => syncProfile().catch(() => {});
  $('pause-btn').onclick = () => { st.paused = !st.paused; updateProgress(); if (!st.paused) runAnalysis(); };
}

/* ---------- background analysis ---------- */
async function runAnalysis() {
  if (st.running || !st.engA) { updateProgress(); return; }
  st.running = true;
  const epoch = st.epoch, pid = st.pid;
  let sinceSave = 0;
  while (true) {
    if (st.paused || epoch !== st.epoch) break;
    const queue = st.games.slice(0, st.target).filter(g => !st.evals[g.id]);
    if (!queue.length) break;
    const g = queue[0];
    updateProgress();
    const ev = await C.analyseGame(g, st.engA, st.depth, () => st.paused || epoch !== st.epoch);
    if (!ev || epoch !== st.epoch) break;
    st.evals[g.id] = ev;
    st.analysis[g.id] = C.tagGame(g, ev, st.user);
    if (++sinceSave >= 4) { sinceSave = 0; idb.set('evals:' + pid, st.evals); }
    recompute();
    hv.onAnalysed(g.id);
  }
  if (epoch === st.epoch) idb.set('evals:' + pid, st.evals);
  st.running = false;
  updateProgress();
  if (epoch !== st.epoch && !st.paused) runAnalysis();
}
function saveEvals() { if (st.pid) idb.set('evals:' + st.pid, st.evals); }
function updateProgress() {
  const want = Math.min(st.target, st.games.length), done = st.games.slice(0, st.target).filter(g => st.evals[g.id]).length;
  const el = $('progress');
  if (!st.p || !st.games.length || done >= want || currentTab() === 'setup') { el.hidden = true; return; }
  el.hidden = false;
  $('progress-fill').style.width = (100 * done / want) + '%';
  $('progress-text').textContent = !st.engA ? 'Starting the engine…' : st.paused ? `Paused at ${done} of ${want} games` : `Analysing game ${done + 1} of ${want}`;
  $('pause-btn').textContent = st.paused ? 'Resume' : 'Pause';
}


/* ---------- Train: mistakes ---------- */
const pz = {
  stage: null, filter: 'all', rec: null, done: false, tok: 0, list: [], i: -1,
  init() {
    this.stage = new Stage($('pz-stage'), {
      onMove: x => this.onMove(x),
      onNav: a => { if (a === 'reset' && this.rec && !this.done) this.fb('', 'Back at the position. Your move.'); },
      onHint: (e, fen) => { if (this.rec && fen === this.rec.fen && !this.done) { this.mark(false); this.done = true; this.fb('warn', `Hint used. Best was <strong>${esc(sanOf(fen, e.best))}</strong>. Line: ${this.line()}`); this.drawInfo(); } },
    });
    $('pz-prev').onclick = () => this.go(this.i - 1);
    $('pz-next').onclick = () => this.go(this.i + 1);
    $('pz-show').onclick = () => this.show();
    $('pz-filter').onchange = e => { this.filter = e.target.value; pls.set('pzfilter', this.filter); this.rebuild(); this.go(0); };
    $('pz-strip').onclick = e => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      const j = this.list.findIndex(r => r.gid === b.dataset.g); if (j >= 0) this.go(j);
    };
  },
  key: r => r.gid + ':' + r.ply,
  // Newest game first, then move order inside each game.
  rebuild() {
    const all = (st.S?.puzzles || []).filter(r => st.byId[r.gid]);
    this.list = all.filter(r => this.filter === 'all' || r.cat === this.filter)
      .sort((a, b) => (st.gameIdx[a.gid] - st.gameIdx[b.gid]) || (a.ply - b.ply));
    const cats = st.S?.cat || {};
    $('pz-filter').innerHTML = `<option value="all">All mistakes (${all.length})</option>` +
      C.CAT_ORDER.filter(k => cats[k]).map(k => `<option value="${k}"${this.filter === k ? ' selected' : ''}>${esc(C.CATS[k].label)} (${cats[k]})</option>`).join('');
    if (this.filter !== 'all' && !cats[this.filter]) { this.filter = 'all'; return this.rebuild(); }
    $('pz-filter').value = this.filter;
  },
  reset() { this.rec = null; this.i = -1; this.filter = pls.get('pzfilter', 'all'); this.rebuild(); this.resume(); },
  resume() {
    if (!this.list.length) return this.empty();
    const saved = pls.get('pzkey', null);
    const j = saved ? this.list.findIndex(r => this.key(r) === saved) : -1;
    this.go(j >= 0 ? j : 0);
  },
  poke() {
    const cur = this.rec ? this.key(this.rec) : null;
    this.rebuild();
    if (!cur) { if (this.list.length) this.resume(); else this.empty(); return; }
    const j = this.list.findIndex(r => this.key(r) === cur);
    if (j >= 0) { this.i = j; this.rec = this.list[j]; this.navUi(); } else this.go(Math.min(this.i, this.list.length - 1));
  },
  setFilter(k) { this.filter = k; pls.set('pzfilter', k); this.rebuild(); this.go(0); },
  empty() {
    this.rec = null; this.i = -1; this.stage.idle();
    $('pz-pos').innerHTML = '–'; $('pz-strip').innerHTML = ''; $('pz-info').innerHTML = '';
    $('pz-ask').textContent = 'Find a better move'; $('pz-prev').disabled = $('pz-next').disabled = $('pz-show').disabled = true;
    $('pz-count').textContent = '';
    this.fb('', !st.p ? 'Add a profile to start.' : !st.games.length ? 'No games yet. Tap sync at the top to fetch them.' : st.S?.analysed ? 'No positions of this type yet.' : 'Positions appear here as your games are analysed.');
  },
  go(j) {
    if (!this.list.length) return this.empty();
    j = Math.max(0, Math.min(this.list.length - 1, j));
    this.load(this.list[j], j);
  },
  load(r, j) {
    this.rec = r; this.i = j; this.done = false; this.tok++;
    pls.set('pzkey', this.key(r));
    const g = st.byId[r.gid], col = r.fen.split(' ')[1];
    this.stage.setGame({ fens: g.fens, moves: g.moves, evals: st.evals[g.id], anchor: r.ply, orient: col, userColor: col, marks: badPlies(st.analysis[g.id]), anchorNote: 'the position' });
    $('pz-ask').innerHTML = `${col === 'w' ? 'White' : 'Black'} to move. Find a better move.<small>You played ${esc(r.san)} here${r.sev ? ', a ' + r.sev : ''}.</small>`;
    $('pz-show').disabled = false;
    const solved = st.prog[this.key(r)]?.ok;
    this.fb(solved ? 'good' : '', solved ? 'You fixed this one before. Try it again, or move on.' : 'Your move. Step back with ‹ to see how you got here.');
    this.navUi(); this.drawInfo();
  },
  navUi() {
    const r = this.rec, n = this.list.length;
    const gids = []; for (const x of this.list) if (gids[gids.length - 1] !== x.gid) gids.push(x.gid);
    const gi = gids.indexOf(r.gid);
    const solved = st.prog[this.key(r)]?.ok;
    $('pz-pos').innerHTML = `${this.i + 1} of ${n}<small>${solved ? '<span class="solved">Solved ✓</span> · ' : ''}game ${gi + 1} of ${gids.length}</small>`;
    $('pz-prev').disabled = this.i <= 0; $('pz-next').disabled = this.i >= n - 1;
    const all = st.S?.puzzles || [], fixed = all.filter(x => st.prog[this.key(x)]?.ok).length;
    $('pz-count').textContent = `${fixed} of ${all.length} fixed`;
    // game strip
    const strip = $('pz-strip');
    strip.innerHTML = gids.map(id => {
      const g = st.byId[id], col = C.userColor(g, st.user), out = C.gameOutcome(g, col), opp = oppOf(g, col);
      const k = this.list.filter(x => x.gid === id).length;
      return `<button type="button" data-g="${esc(id)}" class="${id === r.gid ? 'on' : ''}"><b>${shortDate(g.date)} · ${esc(opp.name)}</b><span><span class="res ${out}">${out === 'win' ? 'Won' : out === 'loss' ? 'Lost' : out === 'draw' ? 'Draw' : '–'}</span> · ${plural(k, 'mistake')}</span></button>`;
    }).join('');
    const on = strip.querySelector('.on');
    if (on) { const l = on.offsetLeft - strip.offsetLeft, w = on.offsetWidth; if (l < strip.scrollLeft || l + w > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = l - 12; }
  },
  drawInfo() { if (this.rec) $('pz-info').innerHTML = infoCard(this.rec, this.done); },
  fb(cls, html) { const el = $('pz-fb'); el.className = 'fb ' + cls; el.innerHTML = html; },
  mark(ok) { const k = this.key(this.rec); const p = st.prog[k] = st.prog[k] || { ok: 0, fail: 0 }; ok ? p.ok++ : p.fail++; pls.set('prog', st.prog); this.navUi(); },
  line() { const s = pvSan(this.rec.fen, this.rec.pv); return s.length ? `<span class="mono">${esc(s.join(' '))}</span>` : ''; },
  async onMove({ first, after, mv }) {
    const r = this.rec; if (!r || !first || this.done) return;
    const tok = ++this.tok, best = r.best, uci = mv.from + mv.to + (mv.promotion || '');
    if (best.slice(0, 4) === uci.slice(0, 4)) {
      this.done = true; this.mark(true); this.drawInfo();
      return this.fb('good', `<strong>${esc(sanOf(r.fen, best))}</strong> is the engine's move. Line: ${this.line()}`);
    }
    if (uci === r.uci) return this.fb('bad', `<strong>${esc(mv.san)}</strong> is what you played in the game. Play on to see why it fails, or press Reset.`);
    if (!st.engI) return this.fb('warn', 'Not the engine move. The engine is still starting, so other moves cannot be checked yet. Press Reset to try again.');
    this.fb('', 'Checking ' + esc(mv.san) + '…');
    const t = C.terminalEval(after);
    const e = t ? (t.lost ? { mate: -1 } : { cp: 0, mate: null }) : await st.engI.analyse(after, st.depth);
    if (this.rec !== r || tok !== this.tok) return;
    const loss = r.wpB - (100 - C.winPct(e));
    if (loss < 6) { this.done = true; this.mark(true); this.drawInfo(); return this.fb('good', `<strong>${esc(mv.san)}</strong> works too. The engine preferred ${esc(sanOf(r.fen, best))}.`); }
    this.fb('bad', `<strong>${esc(mv.san)}</strong> gives up about ${Math.round(loss)} points of win chance. Play on to see why, or press Reset.`);
  },
  show() {
    const r = this.rec; if (!r) return;
    if (!this.done) this.mark(false);
    this.done = true; this.tok++;
    const s = this.stage; s.vari = []; s.idx = s.main.anchor; s.arrow = [r.best.slice(0, 2), r.best.slice(2, 4)]; s.show();
    this.fb('warn', `Best was <strong>${esc(sanOf(r.fen, r.best))}</strong>. Line: ${this.line()}`);
    this.drawInfo();
  },
};

/* ---------- Train: speed drill ---------- */
const dr = {
  stage: null, rec: null, running: false, live: false, streak: 0, t0: 0, raf: 0, seen: new Set(),
  stats: { n: 0, ok: 0, time: 0 },
  get budget() { return pls.get('budget', 10); },
  set budget(v) { pls.set('budget', v); },
  init() {
    this.stage = new Stage($('dr-stage'), { onMove: x => this.answer(x) });
    $('dr-start').onclick = () => { if (this.running && !this.live) this.next(); else if (!this.running) { this.running = true; this.stats = { n: 0, ok: 0, time: 0 }; this.next(); } };
    $('dr-stop').onclick = () => this.stop();
    this.idle();
  },
  reset() { this.stop(); this.seen = new Set(); this.streak = 0; },
  poke() { if (!this.running) this.idle(); },
  pool() {
    const S = st.S; if (!S) return [];
    const m = new Map();
    for (const r of S.sinks) if (r.best && r.spent >= 6 && st.byId[r.gid]) m.set(r.gid + ':' + r.ply, r);
    for (const r of S.puzzles) if (st.byId[r.gid]) m.set(r.gid + ':' + r.ply, r);
    return [...m.values()];
  },
  idle() {
    cancelAnimationFrame(this.raf); this.live = false;
    const n = this.pool().length;
    this.stage.idle();
    $('dr-clock').textContent = fmt1(this.budget) + 's';
    $('dr-timer').querySelector('i').style.transform = 'scaleX(1)'; $('dr-timer').classList.remove('low');
    $('dr-start').textContent = 'Start'; $('dr-start').disabled = !n;
    $('dr-info').hidden = true;
    this.fb('', n ? `${n} positions ready. Press Start when you are ready.` : 'Positions appear here as your games are analysed.');
    this.count();
  },
  stop() { this.running = false; this.rec = null; this.idle(); },
  startWith(r) { setTrainMode('dr'); this.running = true; this.next(r); },
  count() { const s = this.stats; $('dr-count').textContent = `Timer ${fmt1(this.budget)}s · streak ${this.streak}` + (s.n ? ` · ${s.ok} of ${s.n} passed · ${fmt1(s.time / s.n)}s average` : ''); },
  fb(cls, html) { const el = $('dr-fb'); el.className = 'fb ' + cls; el.innerHTML = html; },
  next(force) {
    const pool = this.pool(); if (!pool.length) return this.stop();
    let cand = pool.filter(r => !this.seen.has(r.gid + ':' + r.ply));
    if (!cand.length) { this.seen = new Set(); cand = pool; }
    const r = force || cand[Math.floor(Math.random() * cand.length)];
    this.seen.add(r.gid + ':' + r.ply);
    this.rec = r; this.live = true;
    const col = r.fen.split(' ')[1], g = st.byId[r.gid];
    this.stage.setGame({ fens: g.fens, moves: g.moves, evals: st.evals[g.id], anchor: r.ply, orient: col, userColor: col, marks: badPlies(st.analysis[g.id]), anchorNote: 'the drill position', quiet: true });
    $('dr-info').hidden = true;
    this.fb('', `${col === 'w' ? 'White' : 'Black'} to move. Go.`);
    $('dr-start').textContent = 'Next'; $('dr-start').disabled = true;
    this.t0 = performance.now(); this.tick();
  },
  tick() {
    if (!this.live) return;
    const el = (performance.now() - this.t0) / 1000, left = this.budget - el;
    $('dr-clock').textContent = fmt1(Math.max(0, left)) + 's';
    $('dr-timer').querySelector('i').style.transform = `scaleX(${Math.max(0, left / this.budget)})`;
    $('dr-timer').classList.toggle('low', left < this.budget * 0.3);
    if (left <= 0) return this.finish(false, null, 'Out of time.');
    this.raf = requestAnimationFrame(() => this.tick());
  },
  async answer({ first, after, mv }) {
    const r = this.rec; if (!r || !this.live || !first) return;
    const took = (performance.now() - this.t0) / 1000;
    this.live = false; cancelAnimationFrame(this.raf);
    if (mv.from + mv.to === r.best.slice(0, 4)) return this.finish(true, took, `<strong>${esc(mv.san)}</strong> is the engine's choice.`);
    if (!st.engI) return this.finish(false, took, `Not the engine move, and the engine is not running to check it.`);
    this.fb('', 'Checking…');
    const t = C.terminalEval(after);
    const e = t ? (t.lost ? { mate: -1 } : { cp: 0, mate: null }) : await st.engI.analyse(after, st.depth);
    if (this.rec !== r) return;
    const loss = r.wpB - (100 - C.winPct(e));
    if (loss < 7) this.finish(true, took, `<strong>${esc(mv.san)}</strong> is solid.`);
    else this.finish(false, took, `<strong>${esc(mv.san)}</strong> gives up about ${Math.round(loss)} points of win chance.`);
  },
  finish(ok, took, msg) {
    const r = this.rec, s = this.stage; this.live = false; cancelAnimationFrame(this.raf);
    this.stats.n++; if (ok) { this.stats.ok++; this.streak++; } else this.streak = 0;
    this.stats.time += took ?? this.budget;
    if (ok && this.streak > 0 && this.streak % 3 === 0) this.budget = Math.max(3, this.budget - 1);
    if (!ok) this.budget = Math.min(12, this.budget + 1);
    s.quiet = false;
    if (!ok) { s.vari = []; s.idx = s.main.anchor; s.arrow = [r.best.slice(0, 2), r.best.slice(2, 4)]; }
    s.show();
    this.fb(ok ? 'good' : 'bad', `${msg}${took != null ? ` You took ${fmt1(took)}s.` : ''} Engine: <strong>${esc(sanOf(r.fen, r.best))}</strong>. The board is free now: try other moves or press Next.`);
    $('dr-info').innerHTML = infoCard(r, true); $('dr-info').hidden = false;
    $('dr-start').disabled = false; $('dr-start').textContent = 'Next';
    this.count();
  },
};

function setTrainMode(m) {
  st.trainMode = m;
  document.querySelectorAll('#view-train .seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('pz-panel').hidden = m !== 'pz'; $('dr-panel').hidden = m !== 'dr'; $('pz-filter').hidden = m !== 'pz';
  if (m === 'pz' && dr.live) dr.stop();
  if (location.hash !== '#train') location.hash = '#train';
}
function initTrain() {
  pz.init(); dr.init();
  document.querySelector('#view-train .seg').onclick = e => { const b = e.target.closest('[data-mode]'); if (b) setTrainMode(b.dataset.mode); };
}


/* ---------- Ghost ---------- */
const gh = {
  stage: null, chess: null, me: 'w', on: false, clk: { w: 180, b: 180 }, useClock: true, turnStart: 0, timer: 0, elo: 1400, book: true, src: null, plies: 0,
  thinking: false, gtok: 0, fens: [], mvs: [], undos: 0, offset: 0,
  stop() {
    clearInterval(this.timer); this.gtok++; this.on = false; this.chess = null;
    if (!this.stage) return;
    this.stage.idle();
    $('gh-resign').disabled = true; $('gh-undo').disabled = true; $('gh-start').textContent = 'Start game';
    $('gh-moves').textContent = ''; $('gh-top-clk').textContent = '3:00'; $('gh-bot-clk').textContent = '3:00';
    ['gh-top-clk', 'gh-bot-clk'].forEach(id => $(id).classList.remove('on', 'low'));
    this.fb('', 'Pick a start and press Start game.');
  },
  init() {
    this.stage = new Stage($('gh-stage'), { onLiveMove: m => this.userMove(m), resetLabel: 'Back to the end' });
    $('gh-start').onclick = () => this.start();
    $('gh-resign').onclick = () => this.end('loss', 'You resigned.');
    $('gh-undo').onclick = () => this.takeback();
    $('gh-elo').oninput = e => { $('gh-elo-val').textContent = e.target.value; };
  },
  start() {
    if (!st.engI) return this.fb('bad', 'The engine is not running on this device, so the ghost cannot play.');
    const mode = $('gh-mode').value;
    this.elo = +$('gh-elo').value; this.useClock = $('gh-clock').checked; this.src = null; this.plies = 0; this.undos = 0; this.offset = 0; this.gtok++;
    const base = st.games[0]?.base || 180;
    this.clk = { w: base, b: base };
    let fen = new Chess().fen();
    if (mode === 'worst') {
      const list = (st.S?.puzzles || []).filter(r => r.sev === 'blunder');
      const pick = list.length ? list : (st.S?.puzzles || []);
      if (!pick.length) return this.fb('warn', 'No blunder positions yet. Wait for the analysis or start from move one.');
      const r = pick[Math.floor(Math.random() * Math.min(pick.length, 40))];
      const g = st.byId[r.gid];
      this.src = r; fen = r.fen; this.me = fen.split(' ')[1]; this.book = false; this.offset = r.ply;
      if (r.left != null) this.clk[this.me] = Math.max(15, r.left);
      const oppClk = g && r.ply > 0 ? g.moves[r.ply - 1].clk : null;
      if (oppClk != null) this.clk[this.me === 'w' ? 'b' : 'w'] = Math.max(15, oppClk);
    } else { this.me = mode; this.book = true; }
    st.book = C.buildBook(st.games, st.user, st.evals);
    this.chess = new Chess(fen); this.on = true; this.thinking = false; this.fens = [fen]; this.mvs = [];
    $('gh-resign').disabled = false; $('gh-start').textContent = 'New game';
    $('gh-top-name').textContent = `Ghost (about ${this.elo})`; $('gh-bot-name').textContent = st.p ? st.p.name : 'You';
    this.fb('', this.src ? `You played <strong>${esc(this.src.san)}</strong> here and it went wrong. Play it out better.` : 'Good luck.');
    this.turnStart = performance.now();
    clearInterval(this.timer); this.timer = setInterval(() => this.tickClock(), 100);
    this.sync();
    if (this.chess.turn() !== this.me) this.ghostMove();
  },
  fb(cls, html) { const el = $('gh-fb'); el.className = 'fb ' + cls; el.innerHTML = html; },
  live(color) { if (!this.on || !this.useClock || this.chess.turn() !== color) return this.clk[color]; return this.clk[color] - (performance.now() - this.turnStart) / 1000; },
  tickClock() {
    if (!this.chess) return;
    const top = this.me === 'w' ? 'b' : 'w';
    for (const [id, col] of [['gh-top-clk', top], ['gh-bot-clk', this.me]]) {
      const v = this.live(col), el = $(id);
      el.textContent = this.useClock ? clockText(v) : '–';
      el.classList.toggle('on', this.on && this.chess.turn() === col); el.classList.toggle('low', this.useClock && v < 20);
    }
    if (this.on && this.useClock) {
      const t = this.chess.turn();
      if (this.live(t) <= 0) this.end(t === this.me ? 'loss' : 'win', t === this.me ? 'You ran out of time.' : 'The ghost ran out of time.');
    }
  },
  moveText() {
    $('gh-moves').textContent = this.mvs.map((m, i) => { const ply = this.offset + i; return (ply % 2 === 0 ? (Math.floor(ply / 2) + 1) + '. ' : (i === 0 ? (Math.floor(ply / 2) + 1) + '… ' : '')) + m.san; }).join(' ');
    $('gh-moves').scrollTop = 1e6;
    $('gh-undo').disabled = !this.on || !this.mvs.some(m => m.color === this.me);
    $('gh-undo').textContent = this.undos ? `Take back (${this.undos} used)` : 'Take back';
  },
  commit(mv) {
    const col = mv.color;
    if (this.useClock) this.clk[col] -= (performance.now() - this.turnStart) / 1000;
    this.turnStart = performance.now(); this.plies++;
    this.mvs.push({ san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured || null, color: mv.color, clk: null });
    this.fens.push(this.chess.fen());
    this.sync();
    if (this.chess.isCheckmate()) return this.end(col === this.me ? 'win' : 'loss', col === this.me ? 'Checkmate. You beat the ghost.' : 'Checkmate. The ghost got you.'), true;
    if (this.chess.isGameOver()) return this.end('draw', 'Draw.'), true;
    return false;
  },
  sync() {
    const lm = this.mvs[this.mvs.length - 1];
    this.stage.live(this.chess.fen(), { orient: this.me, movable: this.on && this.chess.turn() === this.me ? this.me : false, last: lm ? [lm.from, lm.to] : null });
    this.moveText(); this.tickClock();
  },
  userMove(m) {
    if (!this.on || this.chess.turn() !== this.me) return this.stage.board.render();
    let mv; try { mv = this.chess.move(m); } catch (e) { return this.stage.board.render(); }
    if (!this.commit(mv)) this.ghostMove();
  },
  takeback() {
    if (!this.on) return;
    // Undo back to the position before your last move. Clock time already spent stays spent.
    let n = 0;
    if (this.chess.turn() !== this.me) n = 1;            // ghost is still thinking: undo just your move
    else if (this.mvs.length >= 2) n = 2;                // undo the ghost's reply and your move
    if (!n || !this.mvs.slice(-n).some(m => m.color === this.me)) return;
    this.gtok++; this.thinking = false;
    for (let i = 0; i < n; i++) { this.chess.undo(); this.mvs.pop(); this.fens.pop(); }
    this.plies -= n; this.undos++; this.turnStart = performance.now();
    this.fb('warn', `Move taken back. That is ${this.undos} this game, and the clock time is not refunded.`);
    this.sync();
  },
  async ghostMove() {
    const game = this.chess, t0 = performance.now(), tok = ++this.gtok; this.thinking = true;
    const fen = game.fen();
    let uci = this.book && this.plies < 24 ? C.bookMove(st.book, fen) : null;
    if (uci) { try { new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (e) { uci = null; } }
    const left = this.clk[game.turn()];
    if (!uci) {
      this.book = false;
      // Real thinking time: Stockfish's rating levels assume about a second a move, so a short
      // search plays far below the slider. Keep enough in hand not to flag in fast games.
      const think = this.useClock ? Math.max(150, Math.min(1500, left * 1000 / 30)) : 1200;
      const legal = game.moves({ verbose: true });
      const slip = this.elo < 1320 ? (1320 - this.elo) / 1320 * 0.45 : 0;
      if (Math.random() < slip) { const x = legal[Math.floor(Math.random() * legal.length)]; uci = x.from + x.to + (x.promotion || ''); }
      else { const r = await st.engI.play(fen, this.elo, think); uci = r.best; }
    }
    if (tok !== this.gtok || this.chess !== game || !this.on) return;
    const want = this.useClock ? Math.min(left * 1000 / 12, 350 + Math.random() * (left < 20 ? 500 : 1700)) : 350;
    await new Promise(r => setTimeout(r, Math.max(0, want - (performance.now() - t0))));
    if (tok !== this.gtok || this.chess !== game || !this.on) return;
    let mv; try { mv = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (e) { mv = game.move(game.moves()[0]); }
    this.thinking = false;
    this.commit(mv);
  },
  end(result, msg) {
    if (!this.on) return;
    this.on = false; clearInterval(this.timer); this.gtok++;
    const rec = pls.get('ghost', { win: 0, draw: 0, loss: 0, assisted: 0 }); rec[result]++; if (this.undos) rec.assisted = (rec.assisted || 0) + 1; pls.set('ghost', rec);
    $('gh-resign').disabled = true;
    let extra = '';
    if (this.src) { const g = st.byId[this.src.gid]; if (g) extra = ` The real game ended as a ${C.gameOutcome(g, this.me)}.`; }
    if (this.undos) extra += ` You used ${this.undos} takeback${this.undos > 1 ? 's' : ''}.`;
    const cls = result === 'win' ? 'good' : result === 'loss' ? 'bad' : 'warn', head = esc(msg) + esc(extra);
    this.moveText(); this.tickClock(); ghRecord();
    this.review(cls, head);
  },
  async review(cls, head) {
    const game = this.chess, me = this.me;
    const fake = { id: 'ghost', white: me === 'w' ? 'you' : 'ghost', black: me === 'b' ? 'you' : 'ghost', base: null, inc: 0, moves: this.mvs.slice(), fens: this.fens.slice() };
    if (!game) return;
    const set = (evals, marks) => this.stage.setGame({ fens: fake.fens, moves: fake.moves, evals, anchor: fake.fens.length - 1, orient: me, userColor: me, marks, offset: this.offset, anchorNote: 'final position' });
    set(null, []);
    if (fake.moves.length < 2 || !st.engI) return this.fb(cls, head + ' Step back through the game with the arrows and try other moves from any position.');
    this.fb(cls, head + ' Reviewing your game…');
    const evals = await C.analyseGame(fake, st.engI, st.depth, () => this.chess !== game || this.on);
    if (!evals || this.chess !== game || this.on) return;
    const recs = C.tagGame(fake, evals, 'you');
    const b = recs.filter(r => r.sev === 'blunder').length, m = recs.filter(r => r.sev === 'mistake').length;
    const keep = this.stage.mode === 'explore' ? { idx: this.stage.idx, vari: this.stage.vari } : null;
    set(evals, badPlies(recs));
    if (keep) { this.stage.idx = keep.idx; this.stage.vari = keep.vari; this.stage.show(); }
    this.fb(cls, head + ` Review ready: <strong>${b}</strong> blunder${b === 1 ? '' : 's'} and <strong>${m}</strong> mistake${m === 1 ? '' : 's'} by you. Step through with the arrows, jump to a red dot on the graph, and try other moves from any position.`);
  },
};
function ghRecord() { const r = pls.get('ghost', { win: 0, draw: 0, loss: 0 }); $('gh-record').textContent = `Record against the ghost: ${r.win} won, ${r.draw} drawn, ${r.loss} lost` + (r.assisted ? ` (${r.assisted} with takebacks)` : ''); }


/* ---------- History ---------- */
const hv = {
  stage: null, res: 'all', tc: 'all', shown: 40, gid: null, tok: 0, oppRecs: null,
  init() {
    this.stage = new Stage($('h-stage'), { resetLabel: 'Undo my moves', resetMode: 'branch', onShow: () => this.markMove() });
    $('h-res').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; this.res = b.dataset.r; this.shown = 40; this.renderList(); };
    $('h-tc').onchange = e => { this.tc = e.target.value; this.shown = 40; this.renderList(); };
    $('h-more').onclick = () => { this.shown += 40; this.renderList(); };
    $('h-back').onclick = () => this.close();
    $('h-list').onclick = e => { const b = e.target.closest('[data-g]'); if (b) this.open(b.dataset.g); };
    $('h-moves').onclick = e => { const b = e.target.closest('[data-i]'); if (b) this.stage.goto(+b.dataset.i); };
  },
  reset() { this.res = 'all'; this.tc = 'all'; this.shown = 40; this.close(true); },
  filtered() {
    return st.games.filter(g => {
      const col = C.userColor(g, st.user);
      return (this.res === 'all' || C.gameOutcome(g, col) === this.res) && (this.tc === 'all' || g.tcLabel === this.tc);
    });
  },
  renderList() {
    document.querySelectorAll('#h-res button').forEach(b => b.classList.toggle('on', b.dataset.r === this.res));
    const tcs = {}; for (const g of st.games) tcs[g.tcLabel] = (tcs[g.tcLabel] || 0) + 1;
    if (this.tc !== 'all' && !tcs[this.tc]) this.tc = 'all';
    $('h-tc').innerHTML = `<option value="all">All time controls</option>` + Object.entries(tcs).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<option value="${esc(t)}"${t === this.tc ? ' selected' : ''}>${esc(t)} (${n})</option>`).join('');
    const list = this.filtered();
    $('h-count').textContent = plural(list.length, 'game');
    if (!st.games.length) { $('h-list').innerHTML = `<div class="empty"><strong>No games yet</strong>Tap sync at the top to fetch them.</div>`; $('h-more').hidden = true; return; }
    if (!list.length) { $('h-list').innerHTML = `<div class="empty">No games match these filters.</div>`; $('h-more').hidden = true; return; }
    $('h-list').innerHTML = list.slice(0, this.shown).map(g => {
      const col = C.userColor(g, st.user), out = C.gameOutcome(g, col), opp = oppOf(g, col), recs = st.analysis[g.id];
      const acc = recs ? C.accuracyOf(recs) : null, bl = recs ? recs.filter(r => r.sev === 'blunder').length : null;
      return `<button type="button" class="grow-row" data-g="${esc(g.id)}">
        <span class="stripe ${out}"></span>
        <span class="when">${usDate(g.date)}<br>${esc(g.tcLabel)}</span>
        <span class="vs"><b><i class="cdot ${col}"></i>${esc(opp.name)}${opp.elo ? ' <span style="display:inline;color:var(--dim)">(' + opp.elo + ')</span>' : ''}</b><span>${esc(C.resultText(g, col))} · ${esc(C.openingFamily(g.opening))}</span></span>
        <span class="acc">${acc != null ? Math.round(acc) + '%' : '–'}<span>${acc != null ? 'accuracy' : 'not analysed'}</span></span>
        <span class="bl">${bl != null ? `<b>${bl}</b> ${bl === 1 ? 'blunder' : 'blunders'}` : ''}</span>
      </button>`;
    }).join('');
    $('h-more').hidden = list.length <= this.shown;
  },
  open(gid) {
    const g = st.byId[gid]; if (!g) return;
    this.gid = gid; this.tok++;
    this.listScroll = window.scrollY;
    $('h-list-view').hidden = true; $('h-game-view').hidden = false;
    const col = C.userColor(g, st.user), opp = oppOf(g, col);
    $('h-title').innerHTML = `<b>${esc(st.p.name)}${meElo(g, col) ? ' (' + meElo(g, col) + ')' : ''} vs ${esc(opp.name)}${opp.elo ? ' (' + opp.elo + ')' : ''}</b><span>${esc(C.resultText(g, col))} · ${usDate(g.date)} · ${esc(g.tcLabel)} · ${esc(C.openingFamily(g.opening))}</span>`;
    const link = gameLink(g, null, col);
    $('h-link').hidden = !link; $('h-link').href = link || '#'; $('h-link').textContent = `Open on ${platLabel(g)} ↗`;
    this.stage.setGame({ fens: g.fens, moves: g.moves, evals: st.evals[g.id] || null, anchor: 0, orient: col, userColor: col, marks: badPlies(st.analysis[g.id]), anchorNote: '' });
    this.fill();
    window.scrollTo(0, 0);
    if (!st.evals[g.id]) this.analyseNow(g);
  },
  close(silent) {
    this.gid = null; this.tok++;
    $('h-list-view').hidden = false; $('h-game-view').hidden = true;
    if (!silent) { this.renderList(); window.scrollTo(0, this.listScroll || 0); }
  },
  // Analyse the open game right away on the interactive engine.
  async analyseNow(g) {
    const tok = this.tok, fb = $('h-fb');
    fb.hidden = false; fb.className = 'fb'; fb.textContent = 'Analysing this game…';
    while (!st.engI) { await new Promise(r => setTimeout(r, 300)); if (tok !== this.tok) return; }
    let done = 0;
    const n = Math.min(g.fens.length, 171);
    const counting = { analyse: (fen, d) => st.engI.analyse(fen, d).then(e => { done++; if (tok === this.tok && done % 4 === 0) fb.textContent = `Analysing this game… ${Math.round(100 * done / n)}%`; return e; }) };
    const ev = await C.analyseGame(g, counting, st.depth, () => tok !== this.tok || !!st.evals[g.id]);
    if (!ev) { if (tok === this.tok && st.evals[g.id]) this.onAnalysed(g.id); return; }
    if (!st.evals[g.id]) { st.evals[g.id] = ev; st.analysis[g.id] = C.tagGame(g, ev, st.user); saveEvals(); recompute(); }
    this.onAnalysed(g.id);
  },
  onAnalysed(gid) {
    if (gid !== this.gid) return;
    $('h-fb').hidden = true;
    this.stage.setEvals(st.evals[gid], badPlies(st.analysis[gid]));
    this.fill();
  },
  fill() {
    const g = st.byId[this.gid]; if (!g) return;
    const col = C.userColor(g, st.user), oppCol = col === 'w' ? 'b' : 'w', ev = st.evals[g.id];
    const mine = st.analysis[g.id] || null;
    const theirs = ev ? C.tagGame(g, ev, oppOf(g, col).name) : null;
    const sevOf = {}; for (const r of (mine || []).concat(theirs || [])) if (r.sev) sevOf[r.ply] = r.sev;
    // stats
    const accMe = mine ? C.accuracyOf(mine) : null, accOpp = theirs ? C.accuracyOf(theirs) : null;
    const cnt = s => mine ? mine.filter(r => r.sev === s).length : '–';
    const timed = (mine || []).filter(r => r.spent != null);
    const myMoves = g.moves.filter(m => m.color === col), lastClk = myMoves.length ? myMoves[myMoves.length - 1].clk : null;
    let avg = null, longest = null;
    if (timed.length) { avg = timed.reduce((s, r) => s + r.spent, 0) / timed.length; longest = timed.reduce((a, r) => r.spent > a.spent ? r : a, timed[0]); }
    else if (g.base != null && myMoves.some(m => m.clk != null)) {
      let prev = g.base, sum = 0, k = 0, best = null;
      g.moves.forEach((m, i) => { if (m.color !== col || m.clk == null) return; const sp = Math.max(0, prev - m.clk + g.inc); sum += sp; k++; if (!best || sp > best.spent) best = { spent: sp, ply: i }; prev = m.clk; });
      if (k) { avg = sum / k; longest = best; }
    }
    const tile = (n, l, cls = '') => `<div class="gstat"><div class="n ${cls}">${n}</div><div class="l">${l}</div></div>`;
    $('h-stats').innerHTML =
      tile(accMe != null ? `${Math.round(accMe)}%<small>them ${Math.round(accOpp)}%</small>` : '–', 'Accuracy') +
      tile(cnt('blunder'), 'Blunders', 'bad') + tile(cnt('mistake'), 'Mistakes', 'mis') + tile(cnt('inaccuracy'), 'Inaccuracies', 'ina') +
      tile(avg != null ? fmt1(avg) + 's' : '–', 'Avg move time') +
      tile(longest ? `${Math.round(longest.spent)}s<small>on move ${Math.floor(longest.ply / 2) + 1}</small>` : '–', 'Longest think') +
      tile(lastClk != null ? mmss(lastClk) : '–', 'Clock at the end') +
      tile(Math.ceil(g.moves.length / 2), 'Moves');
    // move list
    let h = '';
    for (let i = 0; i < g.moves.length; i += 2) {
      h += `<span class="no">${i / 2 + 1}.</span>`;
      for (const j of [i, i + 1]) {
        const m = g.moves[j];
        h += m ? `<button type="button" data-i="${j + 1}" class="${sevOf[j] || ''}" title="${sevOf[j] ? sevOf[j] : ''}">${esc(m.san)}</button>` : '<span></span>';
      }
    }
    $('h-moves').innerHTML = h;
    this.markMove();
  },
  markMove() {
    const box = $('h-moves'); if (!box) return;
    const cur = this.stage.vari.length ? -1 : this.stage.idx;
    box.querySelectorAll('button.cur').forEach(b => b.classList.remove('cur'));
    const b = box.querySelector(`[data-i="${cur}"]`);
    if (b) { b.classList.add('cur'); const top = b.offsetTop - box.offsetTop; if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = top - box.clientHeight / 2; }
  },
};


/* ---------- Stats ---------- */
function bars(rows, { hot = true } = {}) {
  const max = Math.max(...rows.map(r => r.value), 0.0001);
  const top = hot ? rows.reduce((a, r) => r.value > a.value ? r : a, rows[0]) : null;
  return '<div class="bars">' + rows.map(r =>
    `<div class="bar${r === top && r.value > 0 ? ' hot' : ''}"${r.tip ? ` title="${esc(r.tip)}"` : ''}><span class="lab">${esc(r.label)}</span><span class="t"><i style="width:${(100 * r.value / max).toFixed(1)}%"></i></span><span class="v">${esc(r.text)}</span></div>`).join('') + '</div>';
}
const CAT_PHRASE = { hung: 'leaving pieces hanging', fork: 'walking into forks', mate_in: 'walking into mate', free: 'passing up free material', tactic: 'missing tactics', mate_miss: 'missing forced mates', quiet: 'quiet slips with no tactic behind them' };
const CLOCK_PHRASE = { c60: 'with over a minute on the clock', c30: 'with 30 to 60 seconds left', c10: 'with 10 to 30 seconds left', c0: 'in the last 10 seconds' };
const rateRows = (obj, defs) => defs.map(d => ({ label: d.label, value: C.rate(obj[d.key]), text: obj[d.key] ? `${fmt1(C.rate(obj[d.key]))} / 100` : 'no moves' }));

function heatHtml(S) {
  const cnt = {}; let max = 0;
  for (const r of S.puzzles) {
    let sq = r.uci.slice(2, 4);
    const g = st.byId[r.gid];
    if (g && C.userColor(g, st.user) === 'b') sq = FILES[7 - FILES.indexOf(sq[0])] + (9 - +sq[1]);
    cnt[sq] = (cnt[sq] || 0) + 1; max = Math.max(max, cnt[sq]);
  }
  let h = '';
  for (let r = 8; r >= 1; r--) for (let f = 0; f < 8; f++) {
    const n = cnt[FILES[f] + r] || 0;
    h += `<div title="${n} mistakes landed here">${n ? `<i style="opacity:${(0.15 + 0.85 * n / max).toFixed(2)}"></i>` : ''}</div>`;
  }
  return `<div class="heat" role="img" aria-label="Board heat map of where mistaken moves landed">${h}</div>`;
}

function lineChart(me, opp, base, who) {
  const n = Math.max(me.length, opp.length), W = 560, H = 220, L = 44, R = 12, T = 12, B = 30;
  const max = base || Math.max(...me.filter(x => x != null), ...opp.filter(x => x != null), 60);
  const x = i => L + (W - L - R) * (n > 1 ? i / (n - 1) : 0), y = v => T + (H - T - B) * (1 - v / max);
  const path = a => { let d = '', pen = false; a.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; }); return d; };
  const yt = [0, max / 3, 2 * max / 3, max].map(v => Math.round(v / 10) * 10);
  const xt = []; for (let i = 9; i < n; i += 10) xt.push(i);
  return `<svg class="linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average clock remaining by move number">
    ${yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#4a4845" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#a8a6a2" font-family="Nunito, sans-serif">${mmss(v)}</text>`).join('')}
    ${xt.map(i => `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#a8a6a2" font-family="Nunito, sans-serif">move ${i + 1}</text>`).join('')}
    <path d="${path(opp)}" fill="none" stroke="#a8a6a2" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="${path(me)}" fill="none" stroke="#f2a33a" stroke-width="2.5"/>
  </svg><div class="legend"><span><i style="background:#f2a33a"></i>${esc(who)}</span><span><i style="background:#a8a6a2"></i>Opponents</span></div>`;
}

function ratingChart(series) {
  if (series.length < 3) return '<p class="note">Not enough rated games to draw a trend.</p>';
  const W = 1000, H = 190, L = 44, R = 10, T = 10, B = 22;
  const v = series.map(s => s.elo), lo = Math.min(...v), hi = Math.max(...v), pad = Math.max(10, (hi - lo) * .1);
  const y0 = lo - pad, y1 = hi + pad, n = series.length;
  const x = i => L + (W - L - R) * i / (n - 1), y = e => T + (H - T - B) * (1 - (e - y0) / (y1 - y0));
  const d = series.map((s, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s.elo).toFixed(1)).join('');
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return `<svg class="linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rating across these games, oldest to newest">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#3d3b38"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#a8a6a2" font-family="Nunito, sans-serif">${t}</text>`).join('')}
    <path d="${d}L${x(n - 1)} ${H - B}L${x(0)} ${H - B}Z" fill="rgba(129,182,76,.14)"/>
    <path d="${d}" fill="none" stroke="#81b64c" stroke-width="2.5"/>
    <circle cx="${x(n - 1)}" cy="${y(v[n - 1])}" r="4" fill="#81b64c"/>
    <text x="${L}" y="${H - 4}" font-size="11" fill="#a8a6a2" font-family="Nunito, sans-serif">${usDate(new Date(series[0].ts).toISOString().slice(0, 10))}</text>
    <text x="${W - R}" y="${H - 4}" text-anchor="end" font-size="11" fill="#a8a6a2" font-family="Nunito, sans-serif">${usDate(new Date(series[n - 1].ts).toISOString().slice(0, 10))}</text>
  </svg>`;
}

function clockTcList() {
  const tcs = {}; for (const g of st.games) if (g.moves.some(m => m.clk != null)) tcs[g.tcLabel] = (tcs[g.tcLabel] || 0) + 1;
  return Object.entries(tcs).sort((a, b) => b[1] - a[1]);
}

function renderStats() {
  const S = st.S, el = $('stats-body');
  if (!S || !S.games) { el.innerHTML = `<div class="empty"><strong>No games yet</strong>Tap sync at the top to fetch them.</div>`; return; }
  el.innerHTML = statsOverview(S) + statsMistakes(S) + statsClock() + statsOpenings(S);
}

function statsOverview(S) {
  const sig = C.signature(S);
  const latest = S.ratingSeries.length ? S.ratingSeries[S.ratingSeries.length - 1].elo : null;
  const first = S.ratingSeries.length ? S.ratingSeries[0].elo : null;
  const delta = latest != null && first != null ? latest - first : null;
  const acc = S.accN ? S.accSum / S.accN : null;
  const winPct = S.games ? Math.round(100 * (S.win + S.draw / 2) / S.games) : 0;
  return `<section class="ssec" id="sec-overview"><h2>Overview</h2><div class="sub">${plural(S.games, 'game')}, ${S.analysed} analysed${st.tc !== 'all' ? ' · ' + esc(st.tc) + ' only' : ''}.</div>
    ${sig ? `<div class="sig"><div class="t"><b>Signature mistake: <em>${esc(CAT_PHRASE[sig.cat])}</em></b><span>${sig.share}% of your ${S.blunders + S.mistakes} blunders and mistakes${sig.phase ? ', most often in the ' + C.PHASES[sig.phase].toLowerCase() : ''}${sig.clock ? ' ' + CLOCK_PHRASE[sig.clock] : ''}.</span></div><button class="btn primary" type="button" data-practice="${sig.cat}">Practise these</button></div>` : ''}
    <div class="tiles">
      <div class="tile"><div class="n">${S.win}–${S.draw}–${S.loss}</div><div class="l">Won · drawn · lost</div><div class="s">${winPct}% score</div></div>
      <div class="tile"><div class="n">${latest ?? '–'}</div><div class="l">Latest rating</div><div class="s">${delta != null ? signed(delta, 0) + ' across these games' : ''}</div></div>
      <div class="tile"><div class="n">${acc != null ? Math.round(acc) + '%' : '–'}</div><div class="l">Average accuracy</div></div>
      <div class="tile"><div class="n" style="color:var(--blunder)">${S.analysed ? fmt1(S.blunders / S.analysed) : '–'}</div><div class="l">Blunders a game</div><div class="s">${S.analysed ? fmt1(S.mistakes / S.analysed) + ' smaller mistakes' : ''}</div></div>
    </div>
    <div class="card"><h2>Rating</h2>${ratingChart(S.ratingSeries)}</div>
  </section>`;
}

function statsMistakes(S) {
  if (!S.analysed) return `<section class="ssec" id="sec-mistakes"><h2>Mistakes</h2><div class="empty">Appears once a few games are analysed.</div></section>`;
  const catRows = C.CAT_ORDER.filter(k => S.cat[k]).map(k => ({ label: C.CATS[k].label, value: S.cat[k], text: S.cat[k] + '×', tip: C.CATS[k].tip })).sort((a, b) => b.value - a.value);
  const phaseRows = rateRows(S.phase, Object.entries(C.PHASES).map(([key, label]) => ({ key, label })));
  const pieceRows = rateRows(S.piece, ['q', 'r', 'b', 'n', 'k', 'p'].map(key => ({ key, label: C.PIECE_NAME[key] + ' moves' })));
  return `<section class="ssec" id="sec-mistakes"><h2>Mistakes</h2><div class="sub">${S.blunders} blunders and ${S.mistakes} mistakes in ${plural(S.analysed, 'analysed game')}.</div>
    <div class="grid2">
      <div class="card"><h2>What goes wrong</h2>${catRows.length ? bars(catRows) : '<p class="note">Nothing yet.</p>'}<p class="note">Blunders and mistakes by type.</p></div>
      <div class="card"><h2>When in the game</h2>${bars(phaseRows)}<p class="note">Per 100 of your moves in each phase.</p></div>
      <div class="card"><h2>Which piece you moved</h2>${bars(pieceRows)}<p class="note">Per 100 moves with that piece.</p></div>
      <div class="card"><h2>Where they land</h2>${S.puzzles.length ? heatHtml(S) : '<p class="note">Nothing yet.</p>'}<p class="note">Squares your mistaken moves went to, from your side of the board.</p></div>
    </div></section>`;
}

function statsClock() {
  const list = clockTcList();
  if (!list.length) return `<section class="ssec" id="sec-clock"><h2>Clock</h2><div class="empty">These games have no clock times.</div></section>`;
  let tc = pls.get('clocktc', null);
  if (!list.some(([t]) => t === tc)) tc = list[0][0];
  const games = st.games.filter(g => g.tcLabel === tc), Sc = C.summarize(games, st.analysis, st.user);
  const base = games[0]?.base;
  const me = Sc.clockCurve.me, opp = Sc.clockCurve.opp;
  const at = [14, 19, 24].map(i => me[i] != null && opp[i] != null ? { mv: i + 1, me: me[i], opp: opp[i] } : null).filter(Boolean).pop();
  const totalT = Object.values(Sc.phaseTime).reduce((s, v) => s + v.time, 0), totalN = Object.values(Sc.phaseTime).reduce((s, v) => s + v.n, 0);
  const long = Sc.think.t8, quick = Sc.think.t1;
  let head = '';
  if (at) { const diff = at.opp - at.me; head = diff > 4 ? `On average you're ${Math.round(diff)}s behind by move ${at.mv}.` : diff < -4 ? `On average you're ${Math.round(-diff)}s ahead by move ${at.mv}.` : `Level on the clock at move ${at.mv}.`; }
  const thinkRows = C.THINK_BUCKETS.map(b => ({ label: b.label, value: C.rate(Sc.think[b.key]), text: Sc.think[b.key] ? `${fmt1(C.rate(Sc.think[b.key]))} / 100` : 'no moves' }));
  const leftRows = C.CLOCK_BUCKETS.map(b => ({ label: b.label, value: C.rate(Sc.clock[b.key]), text: Sc.clock[b.key] ? `${fmt1(C.rate(Sc.clock[b.key]))} / 100` : 'no moves' }));
  const phRows = Object.entries(C.PHASES).map(([k, label]) => { const v = Sc.phaseTime[k]; const a = v && v.n ? v.time / v.n : 0; return { label, value: a, text: fmt1(a) + 's a move' }; });
  const sinks = Sc.sinks.slice(0, 8);
  st.clockSinks = sinks;
  return `<section class="ssec" id="sec-clock"><h2>Clock</h2>
    <div class="btns" style="margin-bottom:12px"><select class="inline" id="st-clocktc" aria-label="Time control for clock stats">${list.map(([t, n]) => `<option value="${esc(t)}"${t === tc ? ' selected' : ''}>${esc(t)} (${plural(n, 'game')})</option>`).join('')}</select><span class="count">${esc(head)}</span></div>
    <div class="tiles">
      <div class="tile"><div class="n">${totalN ? fmt1(totalT / totalN) + 's' : '–'}</div><div class="l">Average per move</div></div>
      <div class="tile"><div class="n"${Sc.lostOnTime ? ' style="color:var(--blunder)"' : ''}>${Sc.lostOnTime}</div><div class="l">Lost on time</div><div class="s">${Sc.wonOnTime} won on time</div></div>
      <div class="tile"><div class="n">${Sc.analysed ? Sc.flaggedWinning : '–'}</div><div class="l">Flagged while better</div></div>
      <div class="tile"><div class="n">${totalN && long ? Math.round(100 * long.n / totalN) : 0}%</div><div class="l">Moves taking 8s+</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Clock left, move by move</h2>${lineChart(me, opp, base, st.p.name)}</div>
      <div class="card"><h2>Seconds per move by phase</h2>${bars(phRows)}</div>
      ${Sc.analysed ? `<div class="card"><h2>Does thinking longer help?</h2>${bars(thinkRows)}<p class="note">Mistakes per 100 moves by how long the move took.</p></div>
      <div class="card"><h2>Mistakes by clock left</h2>${bars(leftRows)}<p class="note">Mistakes per 100 moves by time left when you moved.</p></div>` : ''}
    </div>
    ${sinks.length ? `<div class="card" style="margin-top:14px"><h2>Biggest time sinks</h2><div class="sinks">${sinks.map((r, i) => {
      const g = st.byId[r.gid], opp2 = g ? oppOf(g, r.fen.split(' ')[1]).name : '';
      const tag = r.sev === 'blunder' || r.sev === 'mistake' ? `<span class="tag bad">${r.sev}</span>` : `<span class="tag good">fine move</span>`;
      return `<button type="button" data-sink="${i}"><span class="sec">${Math.round(r.spent)}s</span><span>${g ? usDate(g.date) + ' · ' : ''}move ${Math.floor(r.ply / 2) + 1}, ${esc(r.san)} vs ${esc(opp2)}</span>${tag}</button>`;
    }).join('')}</div><p class="note">Tap one to drill it against the timer.</p></div>` : ''}
  </section>`;
}

function statsOpenings(S) {
  const ops = Object.values(S.openings).sort((a, b) => b.n - a.n).slice(0, 12);
  return `<section class="ssec" id="sec-openings"><h2>Openings</h2><div class="sub">Your most played openings, by family.</div>
    <div class="card"><div class="tblwrap"><table><thead><tr><th>Opening</th><th class="num">Games</th><th>Won · drawn · lost</th><th class="num">Score</th><th class="num">As W / B</th><th class="num">Blunders a game</th></tr></thead><tbody>
    ${ops.map(o => `<tr><td>${esc(o.name)}</td><td class="num">${o.n}</td><td><div class="wdl" title="${o.win} won, ${o.draw} drawn, ${o.loss} lost"><i style="width:${100 * o.win / o.n}%;background:var(--good)"></i><i style="width:${100 * o.draw / o.n}%;background:#77746f"></i><i style="width:${100 * o.loss / o.n}%;background:var(--blunder)"></i></div></td><td class="num">${Math.round(100 * o.pts / o.n)}%</td><td class="num">${o.w} / ${o.b}</td><td class="num">${o.analysed ? fmt1(o.blunders / o.analysed) : '–'}</td></tr>`).join('')}
    </tbody></table></div></div></section>`;
}

function initStats() {
  $('st-nav').onclick = e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    document.querySelectorAll('#st-nav button').forEach(x => x.classList.toggle('on', x === b));
    const sec = $('sec-' + b.dataset.s); if (sec) sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  $('stats-body').addEventListener('change', e => { if (e.target.id === 'st-clocktc') { pls.set('clocktc', e.target.value); const y = window.scrollY; renderStats(); window.scrollTo(0, y); } });
  $('stats-body').addEventListener('click', e => {
    const s = e.target.closest('[data-sink]'); if (s) { const r = (st.clockSinks || [])[+s.dataset.sink]; if (r) dr.startWith(r); return; }
    const p = e.target.closest('[data-practice]'); if (p) { setTrainMode('pz'); pz.setFilter(p.dataset.practice); }
  });
}


/* ---------- Improve ---------- */
const LI = 'https://lichess.org';
const CAT_HELP = {
  hung: { title: 'Pieces left hanging', rule: 'Before I let go of a piece: what does it stop defending, and what attacks the square it lands on?',
    tip: 'Most of these are not deep. A piece moved away from a job it was doing, or landed on an attacked square. Build one habit: before you release the piece, look at what it was defending and count attackers against defenders on its new square. It takes a second and it is the single biggest rating gain at blitz level.',
    links: [['Hanging piece puzzles', '/training/hangingPiece'], ['Defensive move puzzles', '/training/defensiveMove']] },
  fork: { title: 'Walking into forks', rule: 'Before I move: can a knight or the queen hit two of my pieces next turn?',
    tip: 'Forks need two targets. They show up when your king and a heavy piece share a knight-jump, or when you have pieces with no defender. Keep pieces protected by each other and treat every enemy knight within two jumps of your king as a live threat.',
    links: [['Fork puzzles', '/training/fork'], ['Double attack practice', '/practice']] },
  mate_in: { title: 'Walking into mate', rule: 'Before I move: does my king have an escape square, and is my back rank covered?',
    tip: 'You are getting mated from positions that were still playable. Give the king air with a pawn move once your rooks leave the back rank, and when the opponent lines up queen and another piece at your king, deal with that before anything else.',
    links: [['Mate in 1 puzzles', '/training/mateIn1'], ['Back rank mate puzzles', '/training/backRankMate'], ['Mate in 2 puzzles', '/training/mateIn2']] },
  mate_miss: { title: 'Missing forced mates', rule: 'When their king is short of squares, I look at every check first.',
    tip: 'You had a forced mate and played something slower. When the enemy king has few squares, list your checks before anything else. Mating patterns are memory work, so short daily sets beat long sessions.',
    links: [['Mate in 2 puzzles', '/training/mateIn2'], ['Mate in 1 puzzles', '/training/mateIn1'], ['Checkmate patterns practice', '/practice']] },
  free: { title: 'Passing up free material', rule: 'Every move, I scan for enemy pieces that nothing defends.',
    tip: 'Your opponents hang pieces and you do not take them. Before choosing a move, scan the enemy side for anything undefended or attacked more times than it is defended. At your level the simple capture is right far more often than it is a trap.',
    links: [['Hanging piece puzzles', '/training/hangingPiece'], ['Capture the defender puzzles', '/training/capturingDefender']] },
  tactic: { title: 'Missing tactics', rule: 'Every move: my checks, my captures, my threats, in that order.',
    tip: 'The winning move was a check or capture and you played a quiet move instead. Run the same short list on every move: checks, captures, threats. You do not need to calculate them all deeply, only to notice they exist.',
    links: [['Mixed puzzles at your level', '/training/mix'], ['Pick a puzzle theme', '/training/themes']] },
  quiet: { title: 'Quiet mistakes', rule: 'After the opening, I name my plan in five words before I move.',
    tip: 'These are not tactical oversights. The position drifted because the move had no job. Improve your worst-placed piece when nothing is forced, and after each loss run the Lichess computer analysis and use Learn from your mistakes to see where the evaluation turned.',
    links: [['Lichess Practice', '/practice'], ['Middlegame puzzles', '/training/middlegame']] },
};
const PHASE_LINK = { opening: ['Opening puzzles', '/training/opening'], middlegame: ['Middlegame puzzles', '/training/middlegame'], endgame: ['Endgame puzzles', '/training/endgame'] };

function weaknesses(S) {
  const out = [], total = S.blunders + S.mistakes;
  for (const [k, n] of Object.entries(S.cat)) out.push({ kind: 'cat', key: k, n, score: n / Math.max(1, total), total });
  // The clock curve only makes sense inside one time control, so use the most played one.
  const mainTc = (clockTcList()[0] || [])[0];
  const tcGames = mainTc ? st.games.filter(g => g.tcLabel === mainTc) : [];
  const Sc = tcGames.length ? C.summarize(tcGames, st.analysis, st.user) : S;
  const base = tcGames[0]?.base || 180;
  let pick = null; for (const i of [14, 19, 24]) if (Sc.clockCurve.me[i] != null && Sc.clockCurve.opp[i] != null) pick = i;
  const behind = pick != null ? Sc.clockCurve.opp[pick] - Sc.clockCurve.me[pick] : 0;
  const flagShare = S.loss ? S.lostOnTime / S.loss : 0;
  const cscore = Math.max(flagShare, 1.5 * behind / base);
  if (cscore >= 0.15) out.push({ kind: 'clock', score: cscore + 0.05, behind, mv: pick + 1, flagShare });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 3);
}
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const yesterday = () => { const d = new Date(Date.now() - 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function planState() { const p = pls.get('plan', null); return p && p.date === today() ? p : { date: today(), done: [false, false, false, false, false] }; }
function streakNow() { const s = pls.get('streak', { n: 0, last: '' }); return s.last === today() || s.last === yesterday() ? s.n : 0; }

function renderImprove() {
  const S = st.S, el = $('improve-body');
  if (!S || !S.analysed) {
    el.innerHTML = `<div class="empty"><strong>Your plan needs analysed games</strong>${S && S.games ? 'The engine is still reading your games. The plan appears after the first few are analysed.' : 'Tap sync at the top to fetch your games.'}</div>`;
    return;
  }
  const W = weaknesses(S), topCat = W.find(w => w.kind === 'cat'), clockW = W.find(w => w.kind === 'clock');
  const user = st.p && st.p.platform === 'lichess' ? st.user : '';
  const cards = W.map((w, i) => {
    if (w.kind === 'clock') {
      const ev = [];
      if (w.behind > 4) ev.push(`<strong>${Math.round(w.behind)}s</strong> behind your opponents by move ${w.mv}`);
      if (S.lostOnTime) ev.push(`<strong>${S.lostOnTime}</strong> of ${S.loss} losses on time` + (S.flaggedWinning ? `, ${S.flaggedWinning} from a better position` : ''));
      return `<div class="card fix"><div class="rank">${i + 1}</div><div><h2>The clock</h2><p class="ev">${ev.join(' · ')}</p>
        <p class="tipp">Time is costing you games that the board was not. Play your opening moves from memory without stopping, and when two moves both look fine, play the first safe one. A good move now beats the best move with ten seconds left. Give yourself a hard cap: no single move over 10 seconds before move 15.</p>
        <div class="btns"><a class="btn primary" href="#train" data-go="dr">Speed drill</a><a class="btn" href="${LI}/storm" target="_blank" rel="noopener">Lichess Puzzle Storm</a><a class="btn" href="${LI}/racer" target="_blank" rel="noopener">Lichess Puzzle Racer</a></div></div></div>`;
    }
    const h = CAT_HELP[w.key];
    return `<div class="card fix"><div class="rank">${i + 1}</div><div><h2>${esc(h.title)}</h2><p class="ev"><strong>${w.n}</strong> of ${w.total} blunders and mistakes (${Math.round(100 * w.score)}%) in ${S.analysed} games</p>
      <p class="tipp">${esc(h.tip)}</p>
      <div class="btns"><a class="btn primary" href="#train" data-go="pz:${w.key}">Replay these ${w.n} positions</a>${h.links.map(([t, u]) => `<a class="btn" href="${LI}${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join('')}</div></div></div>`;
  }).join('');

  // secondary notes
  const notes = [];
  const ph = Object.entries(S.phase).filter(([, v]) => v.n >= 30).sort((a, b) => C.rate(b[1]) - C.rate(a[1]));
  if (ph.length > 1 && C.rate(ph[0][1]) > 1.25 * C.rate(ph[ph.length - 1][1])) notes.push(`Your error rate is highest in the <strong>${C.PHASES[ph[0][0]].toLowerCase()}</strong> (${fmt1(C.rate(ph[0][1]))} per 100 moves). <a href="${LI}${PHASE_LINK[ph[0][0]][1]}" target="_blank" rel="noopener">${PHASE_LINK[ph[0][0]][0]} on Lichess</a>`);
  const op = Object.values(S.openings).filter(o => o.n >= 3).sort((a, b) => a.pts / a.n - b.pts / b.n)[0];
  if (op && op.pts / op.n < 0.4) notes.push(`You score <strong>${Math.round(100 * op.pts / op.n)}%</strong> in the ${esc(op.name)} over ${op.n} games. <a href="${LI}/opening" target="_blank" rel="noopener">Look it up in the Lichess opening explorer</a> or <a href="${LI}/study/search?q=${encodeURIComponent(op.name)}" target="_blank" rel="noopener">find a study on it</a>.`);
  const long = S.think.t8, quick = S.think.t1;
  if (long && quick && long.n >= 8 && quick.n >= 8 && C.rate(long) >= 0.85 * C.rate(quick)) notes.push(`Moves you spend 8 seconds or more on go wrong about as often as quick ones (${fmt1(C.rate(long))} against ${fmt1(C.rate(quick))} per 100), so the long thinks are not buying accuracy.`);
  if (user) notes.push(`Lichess keeps its own numbers on you: <a href="${LI}/insights/${encodeURIComponent(user)}" target="_blank" rel="noopener">Chess Insights</a> and your <a href="${LI}/training/dashboard/30" target="_blank" rel="noopener">puzzle dashboard</a> show which puzzle themes you fail most.`);

  // daily plan
  const h = topCat ? CAT_HELP[topCat.key] : CAT_HELP.tactic, key = topCat ? topCat.key : 'tactic';
  const rule = clockW && W[0] === clockW ? 'No move over 10 seconds before move 15.' : h.rule;
  const tcCount = {}; for (const g of st.games) tcCount[g.tcLabel] = (tcCount[g.tcLabel] || 0) + 1;
  const mainTc = (Object.entries(tcCount).sort((a, b) => b[1] - a[1])[0] || ['3+0'])[0];
  const blocks = [
    [10, 'Warm up on Lichess', `${h.links[0][0]}. Go for accuracy, not speed.`, `<a href="${LI}${h.links[0][1]}" target="_blank" rel="noopener">Open on Lichess</a>`],
    [15, 'Fix your own blunders here', `Replay your "${C.CATS[key].label.toLowerCase()}" positions until the right move feels obvious.`, `<a href="#train" data-go="pz:${key}">Open the positions</a>`],
    [10, clockW ? 'Speed work, twice as important for you' : 'Speed work', 'The speed drill here, or three runs of Puzzle Storm on Lichess.', `<a href="#train" data-go="dr">Speed drill</a> · <a href="${LI}/storm" target="_blank" rel="noopener">Puzzle Storm</a>`],
    [20, `Play ${esc(mainTc)} games with one rule`, `Today's rule: ${rule}`, st.p.platform === 'chesscom' ? `<a href="https://www.chess.com/play/online" target="_blank" rel="noopener">Play on Chess.com</a>` : `<a href="${LI}/" target="_blank" rel="noopener">Play on Lichess</a>`],
    [5, 'Review one loss', 'Open your latest loss in History and step through where it turned, or replay a blunder position against the ghost.', `<a href="#history">History</a> · <a href="#ghost">Play the ghost</a>`],
  ];
  const ps = planState(), sn = streakNow(), doneN = ps.done.filter(Boolean).length;
  el.innerHTML = `
    <h1 style="margin-bottom:4px">Three things to <em>fix</em></h1><p class="dim" style="margin-bottom:14px">Ranked from ${plural(S.analysed, 'analysed game')}. Work on them in this order.</p>
    <div class="fixes">${cards || '<div class="empty">No clear weaknesses in the games analysed so far.</div>'}</div>
    ${notes.length ? `<div class="card" style="margin-bottom:20px"><h2>Also worth knowing</h2><ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul></div>` : ''}
    <h2 style="font-size:22px;font-weight:900">Today's hour</h2>
    <div class="card plan">
      <div class="planhead"><span class="streak"><b>${sn}</b> day streak</span><span class="count">${doneN} of 5 done today</span></div>
      ${blocks.map((b, i) => `<label class="pb${ps.done[i] ? ' done' : ''}"><input type="checkbox" id="plan-${i}" data-plan="${i}"${ps.done[i] ? ' checked' : ''}><span class="min">${b[0]} min</span><span class="what"><b>${esc(b[1])}</b><span>${esc(b[2])}</span><span class="go">${b[3]}</span></span></label>`).join('')}
      <p class="note">Tick all five to keep the streak. Once a week, load your newest games on the My games tab so the plan follows what you are getting wrong now.</p>
    </div>`;
}
function initImprove() {
  $('improve-body').addEventListener('change', e => {
    const i = e.target.dataset?.plan; if (i == null) return;
    const ps = planState(); ps.done[+i] = e.target.checked; pls.set('plan', ps);
    if (ps.done.every(Boolean)) { const s = pls.get('streak', { n: 0, last: '' }); if (s.last !== today()) { s.n = s.last === yesterday() ? s.n + 1 : 1; s.last = today(); pls.set('streak', s); } }
    renderImprove();
  });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-go]'); if (!a) return;
    const go = a.dataset.go;
    e.preventDefault();
    if (go.startsWith('pz:')) { setTrainMode('pz'); pz.setFilter(go.slice(3)); }
    else if (go === 'dr') setTrainMode('dr');
    window.scrollTo(0, 0);
  });
}


/* ---------- setup (add a profile) ---------- */
const su = {
  plat: 'lichess', busy: false,
  init() {
    $('su-plat').onclick = e => { const b = e.target.closest('[data-p]'); if (b) this.setPlat(b.dataset.p); };
    $('su-form').onsubmit = e => { e.preventDefault(); this.submit(); };
    $('su-file').onchange = e => { const f = e.target.files[0]; if (f) this.fromFile(f); };
  },
  setPlat(p) {
    this.plat = p;
    document.querySelectorAll('#su-plat button').forEach(b => b.classList.toggle('on', b.dataset.p === p));
    $('su-user-lab').textContent = SY.PLATFORMS[p].label + ' username';
  },
  open() {
    const first = !st.profiles.length;
    $('su-title').textContent = first ? 'Set up your profile' : 'Add a profile';
    $('su-lede').textContent = first ? 'Pick where you play and enter your username. Your games load right away.' : 'Each profile is one person on one site. Their games load right away.';
    $('su-cancel-wrap').hidden = first;
    $('su-msg').textContent = ''; $('su-msg').className = 'fb setmsg'; $('su-upload').hidden = true;
    $('su-go').disabled = false;
    if (!$('su-name').value && first) $('su-name').focus({ preventScroll: true });
  },
  msg(cls, html) { const el = $('su-msg'); el.className = 'fb setmsg ' + cls; el.innerHTML = html; },
  fields() {
    const username = $('su-user').value.trim().replace(/^@/, '');
    const name = $('su-name').value.trim() || username;
    return { name, username };
  },
  async submit() {
    if (this.busy) return;
    const { name, username } = this.fields();
    if (!username) { this.msg('bad', 'Enter a username.'); $('su-user').focus(); return; }
    if (st.profiles.some(p => p.platform === this.plat && p.username.toLowerCase() === username.toLowerCase())) { this.msg('bad', 'That account already has a profile on this device.'); return; }
    this.busy = true; $('su-go').disabled = true;
    const label = SY.PLATFORMS[this.plat].label;
    this.msg('', `Checking ${label}…`);
    let real;
    try { real = await SY.checkUser(this.plat, username); }
    catch (e) {
      this.busy = false; $('su-go').disabled = false;
      if (e.kind === 'notfound') return this.msg('bad', `${label} has no player called "${esc(username)}". Check the spelling.`);
      this.showUpload(username);
      return this.msg('bad', e.kind === 'network' ? `Couldn't reach ${label} from this page. If it's open inside Claude, syncing is blocked there. You can load a games file below instead.` : `${label} had a problem. Try again in a minute, or load a games file below.`);
    }
    const p = await this.create(name, real.username);
    this.msg('', `Downloading ${real.username}'s games…`);
    try {
      const added = await syncProfile({ full: true, onProgress: n => this.msg('', `Downloading games… ${n}`) });
      this.msg('good', added ? `Loaded ${plural(added, 'game')}.` : 'No bullet, blitz or rapid games found yet.');
    } catch (e) { this.msg('bad', syncErrorText(e, p)); }
    this.busy = false; $('su-go').disabled = false;
    $('su-name').value = ''; $('su-user').value = '';
    location.hash = '#train';
  },
  async create(name, username) {
    const p = { id: newId(), name: name.slice(0, 30), platform: this.plat, username, created: Date.now(), ...DEFAULTS };
    st.profiles.push(p); st.pid = p.id; saveProfiles();
    await loadProfile(p.id);
    return p;
  },
  showUpload(username) {
    $('su-upload').hidden = false;
    const h = SY.downloadHelp(this.plat, username);
    $('su-dl').innerHTML = `${esc(h.text)} <a href="${esc(h.url)}" target="_blank" rel="noopener">Open ↗</a>`;
  },
  async fromFile(f) {
    const text = await f.text();
    const games = C.parsePgn(text);
    if (!games.length) return this.msg('bad', 'No standard chess games found in that file.');
    let { name, username } = this.fields();
    if (!username || !games.some(g => C.userColor(g, username))) username = C.guessUser(games);
    const p = await this.create(name || username, username);
    const added = await mergeGames(text);
    p.lastSync = Date.now(); saveProfiles();
    refilter(); fillSettings(); runAnalysis();
    this.msg('good', `Loaded ${plural(added, 'game')} for ${esc(username)}.`);
    location.hash = '#train';
  },
};

/* ---------- settings ---------- */
function fillSettings() {
  const p = st.p; if (!p) return;
  $('s-name').value = p.name;
  $('s-acct').innerHTML = `${esc(p.username)} on ${SY.PLATFORMS[p.platform].label} · <a href="${esc(SY.profileUrl(p.platform, p.username))}" target="_blank" rel="noopener">profile ↗</a>` +
    `<div class="note" style="margin-top:2px">${plural(st.all.length, 'game')} saved${p.lastSync ? ' · last synced ' + new Date(p.lastSync).toLocaleString() : ''}</div>`;
  const tcs = {}; for (const g of st.all) tcs[g.tcLabel] = (tcs[g.tcLabel] || 0) + 1;
  $('s-tc').innerHTML = `<option value="all">All time controls (${st.all.length})</option>` + Object.entries(tcs).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<option value="${esc(t)}"${t === st.tc ? ' selected' : ''}>${esc(t)} only (${n})</option>`).join('');
  $('s-tc').value = st.tc;
  $('s-max').value = String(p.max || 300); $('s-target').value = String(p.target || 100);
  const h = SY.downloadHelp(p.platform, p.username);
  $('s-dl').innerHTML = `${esc(h.text)} <a href="${esc(h.url)}" target="_blank" rel="noopener">Open ↗</a>`;
  $('s-profiles').innerHTML = st.profiles.map(x => `${esc(x.name)} · ${SY.PLATFORMS[x.platform].label}${x.id === st.pid ? ' (open now)' : ''}`).join('<br>');
  $('s-delete').textContent = 'Delete profile'; delete $('s-delete').dataset.armed;
}
function smsg(cls, html) { const el = $('s-msg'); el.className = 'fb setmsg ' + cls; el.innerHTML = html; }
function initSettings() {
  $('s-name').onchange = e => { const v = e.target.value.trim(); if (!v || !st.p) return; st.p.name = v.slice(0, 30); saveProfiles(); renderHeader(); fillSettings(); };
  $('s-tc').onchange = e => { st.tc = e.target.value; st.p.tc = st.tc; saveProfiles(); st.epoch++; refilter(); pz.reset(); dr.reset(); hv.reset(); runAnalysis(); fillSettings(); };
  $('s-max').onchange = e => { st.p.max = +e.target.value; saveProfiles(); smsg('', 'Saved. Re-download to fetch more games.'); };
  $('s-target').onchange = e => { st.p.target = st.target = +e.target.value; saveProfiles(); runAnalysis(); updateProgress(); };
  $('s-file').onchange = async e => {
    const f = e.target.files[0]; if (!f || !st.p) return;
    const added = await mergeGames(await f.text());
    refilter(); fillSettings(); runAnalysis();
    smsg(added ? 'good' : '', added ? `Added ${plural(added, 'game')}.` : 'No new games for this profile in that file.');
    e.target.value = '';
  };
  $('s-resync').onclick = async () => {
    smsg('', 'Downloading…');
    try { const n = await syncProfile({ full: true, onProgress: k => smsg('', `Downloading… ${k}`) }); smsg('good', n ? `Added ${plural(n, 'game')}.` : 'Everything was already here.'); fillSettings(); }
    catch (e) { smsg('bad', syncErrorText(e, st.p)); }
  };
  $('s-delete').onclick = async e => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = `Tap again to delete ${st.p.name}`; return; }
    await deleteProfile(st.pid);
  };
}
async function deleteProfile(pid) {
  await idb.del('pgn:' + pid); await idb.del('evals:' + pid);
  try { Object.keys(localStorage).filter(k => k.startsWith('bp:' + pid + ':')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  st.profiles = st.profiles.filter(p => p.id !== pid);
  st.epoch++;
  if (st.profiles.length) { await loadProfile(st.profiles[0].id); location.hash = '#train'; }
  else { st.pid = null; st.p = null; st.all = []; st.evals = {}; saveProfiles(); refilter(); renderHeader(); location.hash = '#setup'; }
}

/* ---------- tabs ---------- */
const TABS = ['train', 'ghost', 'history', 'stats', 'improve', 'settings', 'setup'];
function currentTab() {
  const h = location.hash.replace('#', '');
  if (!st.profiles.length) return 'setup';
  return TABS.includes(h) ? h : 'train';
}
function showTab() {
  const tab = currentTab();
  for (const t of TABS) $('view-' + t).classList.toggle('on', t === tab);
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  if (tab === 'setup') su.open();
  if (tab === 'settings') fillSettings();
  renderVisible();
  updateProgress();
}
window.addEventListener('hashchange', showTab);

/* ---------- migrate data saved by the single-player version ---------- */
async function migrate() {
  if (ls.get('profiles', null)) return;
  const old = await idb.get('pgn');
  if (!old) { ls.set('profiles', []); return; }
  const games = C.parsePgn(old);
  if (!games.length) { ls.set('profiles', []); return; }
  let user = ls.get('user', null);
  if (!user || !games.some(g => C.userColor(g, user))) user = C.guessUser(games);
  const p = { id: newId(), name: user, platform: games[0].platform || 'lichess', username: user, created: Date.now(), ...DEFAULTS };
  p.target = ls.get('target', 100);
  p.lastTs = games.reduce((m, g) => Math.max(m, g.ts || 0), 0);
  p.lastSync = Date.now();
  await idb.set('pgn:' + p.id, games.filter(g => C.userColor(g, user)).map(g => g.raw).join('\n\n'));
  await idb.set('evals:' + p.id, (await idb.get('evals')) || {});
  for (const k of ['prog', 'plan', 'streak', 'ghost', 'budget']) { const v = ls.get(k, null); if (v != null) ls.set(p.id + ':' + k, v); ls.del(k); }
  ls.del('user'); ls.del('target');
  await idb.del('pgn'); await idb.del('evals');
  ls.set('profiles', [p]); ls.set('active', p.id);
}

/* ---------- boot ---------- */
async function boot() {
  initHeader(); initTrain(); gh.init(); hv.init(); initStats(); initImprove(); initSettings(); su.init();
  await idb.open();
  await migrate();
  st.profiles = ls.get('profiles', []);
  const active = ls.get('active', null);
  if (st.profiles.length) {
    await loadProfile(st.profiles.some(p => p.id === active) ? active : st.profiles[0].id);
  } else { renderHeader(); refilter(); }
  showTab();
  if (st.p) syncProfile().catch(() => {});
  st.engA = await makeEngine();
  if (!st.engA) { showAlert('<span>The chess engine could not start in this browser, so games cannot be analysed here.</span>'); updateProgress(); return; }
  st.depth = engineKind.slow ? 8 : 10;
  runAnalysis();
  st.engI = await makeEngine();
  if (!st.engI) st.engI = st.engA;
  for (const s of stages) s.evalNow();
}
boot();

/* ---------- offline + updates ---------- */
// Registers the service worker that keeps the app on the device, and shows a bar when a new version is ready.
function showUpdateBar(worker) {
  const bar = $('update-bar'); if (!bar) return;
  bar.hidden = false;
  $('update-go').onclick = () => { $('update-go').disabled = true; worker.postMessage('SKIP_WAITING'); };
}
async function initOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  let reg;
  try { reg = await navigator.serviceWorker.register('./sw.js'); } catch (e) { return; }   // e.g. inside Claude's preview
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
  const watch = w => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(w); });
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
  watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg.installing));
  const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 30 * 60 * 1000);
}
window.addEventListener('online', () => { syncNote(''); if (st.p) syncProfile().catch(() => {}); });
window.addEventListener('offline', () => syncNote('Offline'));
initOffline();
