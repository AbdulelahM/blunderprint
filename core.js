// Blunderprint core: PGN parsing, engine protocol, mistake tagging, aggregates.
// Pure logic, no DOM. Runs in the browser and in Node (for tests).
import { Chess } from './chess.js';

export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

/* ---------- PGN ---------- */

export function splitPgn(text) {
  return text.replace(/\r/g, '').split(/\n\s*\n(?=\[Event )/).map(s => s.trim()).filter(s => s.startsWith('['));
}

function clkToSec(s) {
  const p = s.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

export function parseGame(str) {
  const h = {};
  const lines = str.split('\n');
  let k = 0;
  for (; k < lines.length; k++) {
    const m = lines[k].match(/^\[(\w+)\s+"(.*)"\]\s*$/);
    if (m) h[m[1]] = m[2]; else if (lines[k].trim() !== '') break;
  }
  const body = lines.slice(k).join(' ');
  const variant = h.Variant || 'Standard';
  if ((variant !== 'Standard' && variant !== 'Chess') || (h.FEN && h.SetUp === '1') || (h.FEN && !/^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w KQkq/.test(h.FEN))) return null;
  const raw = [];
  const re = /\{([^}]*)\}|([^\s{}]+)/g;
  let t, depth = 0;
  while ((t = re.exec(body))) {
    if (t[1] !== undefined) {
      const c = t[1].match(/%clk\s+([\d:.]+)/);
      if (c && raw.length && depth === 0) raw[raw.length - 1].clk = clkToSec(c[1]);
      continue;
    }
    let w = t[2];
    while (w.startsWith('(')) { depth++; w = w.slice(1); }
    let closes = 0;
    while (w.endsWith(')')) { closes++; w = w.slice(0, -1); }
    if (depth === 0) {
      w = w.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
      if (w && !w.startsWith('$') && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(w)) raw.push({ san: w });
    }
    depth = Math.max(0, depth - closes);
  }
  const chess = new Chess();
  const fens = [chess.fen()];
  const moves = [];
  for (const r of raw) {
    let mv;
    try { mv = chess.move(r.san); } catch (e) { break; }
    if (!mv) break;
    moves.push({
      san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), from: mv.from, to: mv.to,
      piece: mv.piece, captured: mv.captured || null, color: mv.color, clk: r.clk ?? null,
    });
    fens.push(chess.fen());
  }
  if (moves.length < 4) return null;
  const tc = (h.TimeControl || '').match(/^(\d+)(?:\+(\d+))?$/);
  const isCC = /chess\.com/i.test(h.Site || '') || /chess\.com/i.test(h.Link || '');
  const site = isCC ? (h.Link || '') : (h.Site || h.GameId || '');
  const id = isCC ? ('cc' + ((site.match(/(\d{5,})/) || [])[1] || [h.UTCDate || h.Date, h.UTCTime || h.StartTime, h.White, h.Black].join('_')))
    : ((site.match(/lichess\.org\/(\w{8})/) || [])[1] || [h.UTCDate || h.Date, h.UTCTime, h.White, h.Black].join('_'));
  const date = (h.UTCDate || h.Date || '').replace(/\./g, '-'), time = h.UTCTime || h.StartTime || '';
  const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/), tm = time.match(/^(\d{1,2}):(\d{2}):(\d{2})/);
  const ts = dm ? Date.UTC(+dm[1], +dm[2] - 1, +dm[3], tm ? +tm[1] : 0, tm ? +tm[2] : 0, tm ? +tm[3] : 0) : 0;
  let opening = h.Opening || '';
  if (!opening && h.ECOUrl) opening = ccOpening(h.ECOUrl);
  const base = tc ? +tc[1] : null, inc = tc ? +(tc[2] || 0) : 0;
  return {
    id, raw: str, platform: isCC ? 'chesscom' : 'lichess', ts, site: /^https?:/.test(site) ? site : '',
    white: h.White || '?', black: h.Black || '?', result: h.Result || '*',
    date, time,
    whiteElo: parseInt(h.WhiteElo) || null, blackElo: parseInt(h.BlackElo) || null,
    base, inc, tcLabel: tc ? tcLabel(base, inc) : (h.TimeControl || '?'), speed: tc ? speedOf(base, inc) : 'other',
    opening, eco: h.ECO || '', termination: h.Termination || '',
    moves, fens,
  };
}

// Chess.com gives the opening as a URL slug, e.g. .../openings/Italian-Game-Giuoco-Pianissimo-Variation-4.d3
export function ccOpening(url) {
  let slug = decodeURIComponent((url.split('/openings/')[1] || '').split('?')[0]);
  slug = slug.replace(/-\d+\..*$/, '').replace(/-/g, ' ').trim();
  if (!slug) return '';
  const m = slug.match(/^(.*?\b(?:Defense|Defence|Game|Opening|Gambit|Attack|System))\b\s*(.*)$/);
  return m && m[2] ? m[1] + ': ' + m[2] : slug;
}

// Lichess's speed buckets: estimated duration = base + 40 * increment.
export function speedOf(base, inc) {
  const t = base + 40 * inc;
  return t < 29 ? 'ultrabullet' : t < 180 ? 'bullet' : t < 480 ? 'blitz' : t < 1500 ? 'rapid' : 'classical';
}

export function tcLabel(base, inc) {
  const m = base / 60;
  return (Number.isInteger(m) ? m : (base < 60 ? '½' : m.toFixed(1))) + '+' + inc;
}

export function parsePgn(text) {
  const out = [], seen = new Set();
  for (const s of splitPgn(text)) {
    let g = null;
    try { g = parseGame(s); } catch (e) { g = null; }
    if (g && !seen.has(g.id)) { seen.add(g.id); out.push(g); }
  }
  out.sort((a, b) => b.ts - a.ts || (b.date + b.time).localeCompare(a.date + a.time));
  return out;
}

export function guessUser(games) {
  const c = {};
  for (const g of games) { c[g.white] = (c[g.white] || 0) + 1; c[g.black] = (c[g.black] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export function userColor(g, user) {
  const u = user.toLowerCase();
  return g.white.toLowerCase() === u ? 'w' : g.black.toLowerCase() === u ? 'b' : null;
}

/* ---------- Engine (UCI over any line transport) ---------- */

export class Engine {
  constructor(send) {
    this.send = send; this.chain = Promise.resolve(); this.cur = null; this.ready = false;
    this.readyP = new Promise(res => { this._ready = res; });
    this.limited = null;
  }
  start() { this.send('uci'); this.send('isready'); return this.readyP; }
  feed(line) {
    if (typeof line !== 'string') return;
    if (line === 'readyok' && !this.ready) { this.ready = true; this._ready(true); return; }
    const c = this.cur;
    if (!c) return;
    if (line.startsWith('info') && line.includes(' pv ')) {
      const sc = line.match(/ score (cp|mate) (-?\d+)/);
      if (sc && !/ (lower|upper)bound/.test(line)) {
        c.info = { cp: sc[1] === 'cp' ? +sc[2] : null, mate: sc[1] === 'mate' ? +sc[2] : null,
          pv: line.split(' pv ')[1].trim().split(' ').slice(0, 4) };
      }
    } else if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      this.cur = null;
      const info = c.info || { cp: 0, mate: null, pv: [] };
      c.resolve({ cp: info.cp, mate: info.mate, best: best && best !== '(none)' ? best : null, pv: info.pv });
    }
  }
  _job(fn) {
    const p = this.chain.then(() => this.readyP).then(fn);
    this.chain = p.catch(() => {});
    return p;
  }
  _go(fen, go) {
    return new Promise(resolve => {
      this.cur = { resolve, info: null };
      this.send('position fen ' + fen);
      this.send(go);
    });
  }
  _strength(elo) {
    if (this.limited === elo) return;
    this.limited = elo;
    if (elo == null) this.send('setoption name UCI_LimitStrength value false');
    else { this.send('setoption name UCI_LimitStrength value true'); this.send('setoption name UCI_Elo value ' + Math.max(1320, Math.min(3190, Math.round(elo)))); }
  }
  // Full-strength evaluation from the side to move's point of view.
  analyse(fen, depth = 10) { return this._job(() => { this._strength(null); return this._go(fen, 'go depth ' + depth); }); }
  // Strength-limited move choice for the ghost.
  play(fen, elo, movetime = 250) { return this._job(() => { this._strength(elo); return this._go(fen, 'go movetime ' + movetime); }); }
}

/* ---------- Evaluation helpers ---------- */

// Win chance in percent for the side to move (Lichess's curve).
export function winPct(e) {
  if (!e) return 50;
  if (e.mate != null) return e.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * e.cp)) - 1);
}

export function terminalEval(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { cp: null, mate: -0, lost: true, best: null, pv: [], terminal: true };
  if (c.isGameOver()) return { cp: 0, mate: null, best: null, pv: [], terminal: true };
  return null;
}

const MAX_PLY = 170;

// Evaluate every position of a game. Returns evals[i] for the position before ply i.
export async function analyseGame(g, engine, depth = 10, shouldStop = () => false) {
  const n = Math.min(g.fens.length, MAX_PLY + 1);
  const evals = new Array(n);
  for (let i = 0; i < n; i++) {
    if (shouldStop()) return null;
    const t = i === g.fens.length - 1 ? terminalEval(g.fens[i]) : null;
    if (t) { evals[i] = t.lost ? { cp: null, mate: -1, best: null, pv: [], terminal: true } : t; continue; }
    const e = await engine.analyse(g.fens[i], depth);
    evals[i] = { cp: e.cp, mate: e.mate, best: e.best, pv: e.pv };
  }
  return evals;
}

/* ---------- Mistake tagging ---------- */

export const CATS = {
  mate_in: { label: 'Walked into mate', tip: 'Your move allowed a forced checkmate.' },
  mate_miss: { label: 'Missed a forced mate', tip: 'You had a forced checkmate and played something else.' },
  hung: { label: 'Hung a piece', tip: 'Your move left a piece where it could simply be taken.' },
  fork: { label: 'Walked into a fork', tip: 'Your move let one enemy piece attack two of yours.' },
  free: { label: 'Missed a free piece', tip: 'There was material to win for nothing and you passed.' },
  tactic: { label: 'Missed a tactic', tip: 'The best move was a check or capture you did not play.' },
  quiet: { label: 'Quiet mistake', tip: 'No single tactic. A plan or calculation went wrong.' },
};
export const CAT_ORDER = ['hung', 'fork', 'mate_in', 'free', 'tactic', 'mate_miss', 'quiet'];

function nonPawnMaterial(fen) {
  let s = 0;
  for (const ch of fen.split(' ')[0]) { const v = VAL[ch.toLowerCase()]; if (v && v > 1) s += v; }
  return s;
}
export function phaseOf(fen, ply) {
  const npm = nonPawnMaterial(fen);
  if (npm <= 14) return 'endgame';
  if (ply < 20 && npm >= 50) return 'opening';
  return 'middlegame';
}
export const PHASES = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };

export const CLOCK_BUCKETS = [
  { key: 'c60', label: 'Over 60s left', min: 60 }, { key: 'c30', label: '30–60s left', min: 30 },
  { key: 'c10', label: '10–30s left', min: 10 }, { key: 'c0', label: 'Under 10s left', min: -1 },
];
export const THINK_BUCKETS = [
  { key: 't0', label: 'Under 1s', max: 1 }, { key: 't1', label: '1–3s', max: 3 },
  { key: 't3', label: '3–8s', max: 8 }, { key: 't8', label: '8s or more', max: Infinity },
];
export const clockBucket = s => CLOCK_BUCKETS.find(b => s >= b.min).key;
export const thinkBucket = s => THINK_BUCKETS.find(b => s < b.max).key;

function parseUci(u) { return u ? { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] } : null; }

// Would this capture win material outright? (victim worth more, or victim undefended)
function winsMaterial(chess, mv) {
  if (!mv.captured || mv.captured === 'p') return false;
  const victimColor = mv.color === 'w' ? 'b' : 'w';
  const c2 = new Chess(chess.fen());
  c2.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  const defended = c2.attackers(mv.to, victimColor).length > 0;
  return !defended || VAL[mv.captured] > VAL[mv.piece];
}

function tryMove(fen, uci) {
  const p = parseUci(uci);
  if (!p) return null;
  const c = new Chess(fen);
  try { const mv = c.move({ from: p.from, to: p.to, promotion: p.promotion }); return mv ? { c, mv, before: new Chess(fen) } : null; }
  catch (e) { return null; }
}

function isFork(c, mv, victimColor) {
  // After mv, does the moved piece attack two or more valuable/loose pieces?
  let hits = 0;
  const board = c.board();
  for (const row of board) for (const sq of row) {
    if (!sq || sq.color !== victimColor) continue;
    if (!c.attackers(sq.square, mv.color).includes(mv.to)) continue;
    const loose = c.attackers(sq.square, victimColor).length === 0;
    if (sq.type === 'k' || VAL[sq.type] > VAL[mv.piece] || (loose && sq.type !== 'p')) hits++;
  }
  return hits >= 2;
}

export function classify(g, i, evals) {
  const before = evals[i], after = evals[i + 1];
  const me = g.moves[i].color, opp = me === 'w' ? 'b' : 'w';
  if (after && after.mate != null && after.mate > 0 && !(before.mate != null && before.mate < 0)) return 'mate_in';
  if (before.mate != null && before.mate > 0 && !(after && after.mate != null && after.mate < 0)) return 'mate_miss';
  const reply = after && after.best ? tryMove(g.fens[i + 1], after.best) : null;
  if (reply) {
    if (winsMaterial(reply.before, reply.mv)) return 'hung';
    if (isFork(reply.c, reply.mv, me)) return 'fork';
  }
  const best = before.best ? tryMove(g.fens[i], before.best) : null;
  if (best) {
    if (winsMaterial(best.before, best.mv)) return 'free';
    if (best.mv.captured || best.c.isCheck()) return 'tactic';
  }
  return 'quiet';
}

export const SEVERITY = { blunder: 15, mistake: 10, inaccuracy: 5 };

// Build per-move records for the user's moves in one analysed game.
export function tagGame(g, evals, user) {
  const col = userColor(g, user);
  if (!col || !evals) return [];
  const recs = [];
  let myClk = g.base, hasClk = g.base != null;
  const n = Math.min(g.moves.length, evals.length - 1);
  for (let i = 0; i < n; i++) {
    const m = g.moves[i];
    if (m.color !== col) continue;
    const before = evals[i], after = evals[i + 1];
    let spent = null, left = null;
    if (hasClk && m.clk != null && myClk != null) { spent = Math.max(0, myClk - m.clk + g.inc); left = myClk; myClk = m.clk; }
    const wpB = winPct(before), wpA = 100 - winPct(after);
    const drop = m.uci === before.best ? 0 : Math.max(0, wpB - wpA);
    const sev = drop >= SEVERITY.blunder ? 'blunder' : drop >= SEVERITY.mistake ? 'mistake' : drop >= SEVERITY.inaccuracy ? 'inaccuracy' : null;
    const r = {
      gid: g.id, ply: i, fen: g.fens[i], san: m.san, uci: m.uci, piece: m.piece,
      best: before.best, pv: before.pv, wpB, wpA, drop, sev,
      phase: phaseOf(g.fens[i], i), spent, left,
    };
    if (sev === 'blunder' || sev === 'mistake') r.cat = classify(g, i, evals);
    recs.push(r);
  }
  return recs;
}

/* ---------- Aggregates ---------- */

export function openingFamily(name) { return (name || 'Unknown opening').split(':')[0].split(',')[0].trim(); }

export function gameOutcome(g, col) {
  if (g.result === '1/2-1/2') return 'draw';
  if (g.result === '1-0') return col === 'w' ? 'win' : 'loss';
  if (g.result === '0-1') return col === 'b' ? 'win' : 'loss';
  return 'other';
}

// Approximate game accuracy from per-move win-chance drops (Lichess-style curve).
export function moveAccuracy(drop) { return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669)); }
export function accuracyOf(recs) {
  if (!recs || !recs.length) return null;
  const a = recs.map(r => moveAccuracy(r.drop));
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const harm = a.length / a.reduce((s, x) => s + 1 / Math.max(x, 5), 0);
  return (mean + harm) / 2;
}

export function summarize(games, analysis, user) {
  const S = {
    games: 0, analysed: 0, win: 0, draw: 0, loss: 0, moves: 0, blunders: 0, mistakes: 0,
    cat: {}, phase: {}, clock: {}, think: {}, piece: {}, openings: {},
    lostOnTime: 0, flaggedWinning: 0, wonOnTime: 0, clockCurve: { me: [], opp: [] },
    phaseTime: {}, sinks: [], puzzles: [], rating: [], ratingSeries: [], accSum: 0, accN: 0,
  };
  const bump = (o, k, f, v = 1) => { (o[k] = o[k] || { n: 0, bad: 0, time: 0 })[f] += v; };
  for (const g of games) {
    const col = userColor(g, user);
    if (!col) continue;
    S.games++;
    const out = gameOutcome(g, col);
    if (S[out] !== undefined) S[out]++;
    const elo = col === 'w' ? g.whiteElo : g.blackElo;
    if (elo) { S.rating.push(elo); S.ratingSeries.push({ ts: g.ts, elo }); }
    const fam = openingFamily(g.opening);
    const op = S.openings[fam] = S.openings[fam] || { name: fam, n: 0, pts: 0, blunders: 0, analysed: 0, win: 0, draw: 0, loss: 0, w: 0, b: 0 };
    op.n++; op.pts += out === 'win' ? 1 : out === 'draw' ? 0.5 : 0;
    if (op[out] !== undefined) op[out]++;
    op[col]++;
    const timeLoss = /time/i.test(g.termination) && out === 'loss';
    if (timeLoss) S.lostOnTime++;
    if (/time/i.test(g.termination) && out === 'win') S.wonOnTime++;
    // clock curve: average clock after each full move, me vs opponent
    for (let i = 0; i < g.moves.length; i++) {
      const m = g.moves[i];
      if (m.clk == null) continue;
      const mvNo = Math.floor(i / 2);
      if (mvNo >= 45) break;
      const arr = m.color === col ? S.clockCurve.me : S.clockCurve.opp;
      (arr[mvNo] = arr[mvNo] || { s: 0, n: 0 }); arr[mvNo].s += m.clk; arr[mvNo].n++;
    }
    const recs = analysis[g.id];
    if (!recs) continue;
    S.analysed++; op.analysed++;
    const acc = accuracyOf(recs);
    if (acc != null) { S.accSum += acc; S.accN++; }
    if (timeLoss && recs.length) {
      const last = recs[recs.length - 1];
      if (last.wpA >= 65) S.flaggedWinning++;
    }
    for (const r of recs) {
      S.moves++;
      const bad = r.sev === 'blunder' || r.sev === 'mistake';
      if (r.sev === 'blunder') { S.blunders++; op.blunders++; }
      if (r.sev === 'mistake') S.mistakes++;
      bump(S.phase, r.phase, 'n'); if (bad) bump(S.phase, r.phase, 'bad');
      bump(S.piece, r.piece, 'n'); if (bad) bump(S.piece, r.piece, 'bad');
      if (r.spent != null) {
        const cb = clockBucket(r.left), tb = thinkBucket(r.spent);
        bump(S.clock, cb, 'n'); bump(S.think, tb, 'n');
        if (bad) { bump(S.clock, cb, 'bad'); bump(S.think, tb, 'bad'); }
        bump(S.phaseTime, r.phase, 'n'); bump(S.phaseTime, r.phase, 'time', r.spent);
        if (r.ply >= 8) S.sinks.push(r);
      }
      if (bad) {
        S.cat[r.cat] = (S.cat[r.cat] || 0) + 1;
        if (r.best) S.puzzles.push(r);
      }
    }
  }
  S.sinks.sort((a, b) => b.spent - a.spent);
  S.sinks = S.sinks.slice(0, 60);
  S.puzzles.sort((a, b) => b.drop - a.drop);
  S.clockCurve.me = S.clockCurve.me.map(x => x && x.n >= 3 ? x.s / x.n : null);
  S.clockCurve.opp = S.clockCurve.opp.map(x => x && x.n >= 3 ? x.s / x.n : null);
  S.ratingSeries.sort((a, b) => a.ts - b.ts);
  S.rating.sort((a, b) => a - b);
  S.medianRating = S.rating.length ? S.rating[Math.floor(S.rating.length / 2)] : null;
  return S;
}

export function isMateEnd(g) { try { return new Chess(g.fens[g.fens.length - 1]).isCheckmate(); } catch (e) { return false; } }
export function resultText(g, col) {
  const out = gameOutcome(g, col), t = g.termination || '';
  const word = out === 'win' ? 'Won' : out === 'loss' ? 'Lost' : out === 'draw' ? 'Draw' : 'Unfinished';
  if (out === 'draw') {
    const m = t.match(/drawn? by ([a-z ]+)/i) || t.match(/(stalemate|repetition|agreement|insufficient material|50-move rule|timeout vs insufficient material)/i);
    return m ? 'Draw by ' + m[1].toLowerCase() : 'Draw';
  }
  if (out === 'other') return word;
  if (/time/i.test(t)) return word + ' on time';
  if (isMateEnd(g) || /checkmate/i.test(t)) return word + ' by checkmate';
  if (/abandon/i.test(t)) return word + ' by abandonment';
  return word + ' by resignation';
}

export const rate = (o) => o && o.n ? (100 * o.bad / o.n) : 0;

// One-sentence headline of the most characteristic mistake pattern.
export function signature(S) {
  const cats = Object.entries(S.cat).sort((a, b) => b[1] - a[1]);
  if (!cats.length) return null;
  const total = cats.reduce((s, c) => s + c[1], 0);
  const [ck, cn] = cats[0];
  const ph = Object.entries(S.phase).filter(([, v]) => v.n >= 20).sort((a, b) => rate(b[1]) - rate(a[1]))[0];
  const cl = Object.entries(S.clock).filter(([, v]) => v.n >= 20).sort((a, b) => rate(b[1]) - rate(a[1]))[0];
  return { cat: ck, share: Math.round(100 * cn / total), phase: ph ? ph[0] : null, clock: cl ? cl[0] : null };
}

/* ---------- Opponent book for the ghost ---------- */

export function buildBook(games, user) {
  const book = {};
  for (const g of games) {
    const col = userColor(g, user);
    if (!col) continue;
    for (let i = 0; i < Math.min(g.moves.length, 24); i++) {
      const m = g.moves[i];
      if (m.color === col) continue;
      const key = g.fens[i].split(' ').slice(0, 4).join(' ');
      (book[key] = book[key] || {})[m.uci] = (book[key][m.uci] || 0) + 1;
    }
  }
  return book;
}

export function bookMove(book, fen, rnd = Math.random) {
  const e = book[fen.split(' ').slice(0, 4).join(' ')];
  if (!e) return null;
  const list = Object.entries(e);
  let total = list.reduce((s, x) => s + x[1], 0), r = rnd() * total;
  for (const [u, n] of list) { r -= n; if (r <= 0) return u; }
  return list[0][0];
}

export { Chess };
