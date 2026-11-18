// Blunderprint sync: pulls a player's public games from Lichess or Chess.com as PGN text.
// Only bullet, blitz and rapid standard chess. No keys needed for either site.

export const PLATFORMS = {
  lichess: { label: 'Lichess', home: 'https://lichess.org' },
  chesscom: { label: 'Chess.com', home: 'https://www.chess.com' },
};

export class SyncError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, opts = {}, tries = 2) {
  let res;
  // no-store: never reuse a saved answer, or a new game can stay hidden for minutes
  try { res = await fetch(url, { cache: 'no-store', ...opts }); }
  catch (e) { throw new SyncError('network', 'blocked'); }
  if (res.status === 429 && tries > 1) { await sleep(2500); return get(url, opts, tries - 1); }
  return res;
}

/* ---------- Lichess ---------- */

async function lichessUser(username) {
  const res = await get(`https://lichess.org/api/user/${encodeURIComponent(username)}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new SyncError('notfound', 'not found');
  if (!res.ok) throw new SyncError('server', 'Lichess answered ' + res.status);
  const j = await res.json();
  if (j.disabled || j.closed) throw new SyncError('notfound', 'closed');
  return { username: j.username || username };
}

async function lichessGames(username, { since = 0, max = 300, onProgress } = {}) {
  const q = new URLSearchParams({ max: String(max), perfType: 'bullet,blitz,rapid', clocks: 'true', opening: 'true', moves: 'true', tags: 'true' });
  if (since) q.set('since', String(since + 1));
  const res = await get(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?${q}`, { headers: { Accept: 'application/x-chess-pgn' } });
  if (res.status === 404) throw new SyncError('notfound', 'not found');
  if (!res.ok) throw new SyncError('server', 'Lichess answered ' + res.status);
  // Stream so the progress count moves on big downloads.
  if (res.body && res.body.getReader && onProgress) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let text = '', n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      const c = (text.match(/\[Event /g) || []).length;
      if (c !== n) { n = c; onProgress(n); }
    }
    return text + dec.decode();
  }
  return res.text();
}

/* ---------- Chess.com ---------- */

const CC_SPEEDS = new Set(['bullet', 'blitz', 'rapid']);

async function chesscomUser(username) {
  const res = await get(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`);
  if (res.status === 404 || res.status === 410) throw new SyncError('notfound', 'not found');
  if (!res.ok) throw new SyncError('server', 'Chess.com answered ' + res.status);
  const j = await res.json();
  return { username: j.username || username };
}

async function chesscomGames(username, { since = 0, max = 300, onProgress } = {}) {
  const u = encodeURIComponent(username.toLowerCase());
  const res = await get(`https://api.chess.com/pub/player/${u}/games/archives`);
  if (res.status === 404) throw new SyncError('notfound', 'not found');
  if (!res.ok) throw new SyncError('server', 'Chess.com answered ' + res.status);
  const archives = ((await res.json()).archives || []).slice().reverse();   // newest month first
  const sinceMonth = since ? new Date(since).getUTCFullYear() * 12 + new Date(since).getUTCMonth() : -1;
  const out = [];
  let months = 0;
  for (const url of archives) {
    const m = url.match(/(\d{4})\/(\d{2})$/);
    if (m && sinceMonth >= 0 && (+m[1]) * 12 + (+m[2] - 1) < sinceMonth) break;
    if (++months > 36) break;
    const r = await get(url);
    if (!r.ok) { if (r.status === 404) continue; throw new SyncError('server', 'Chess.com answered ' + r.status); }
    const games = ((await r.json()).games || []).slice().reverse();          // newest game first
    for (const g of games) {
      if (g.rules !== 'chess' || !CC_SPEEDS.has(g.time_class) || !g.pgn) continue;
      if (since && g.end_time && g.end_time * 1000 <= since) continue;
      out.push(g.pgn);
      if (out.length >= max) break;
    }
    if (onProgress) onProgress(out.length);
    if (out.length >= max) break;
    await sleep(150);                                                       // be polite: one request at a time
  }
  return out.join('\n\n');
}

/* ---------- public ---------- */

export function checkUser(platform, username) {
  return platform === 'chesscom' ? chesscomUser(username) : lichessUser(username);
}

export function fetchGames(platform, username, opts) {
  return platform === 'chesscom' ? chesscomGames(username, opts) : lichessGames(username, opts);
}

export function profileUrl(platform, username) {
  return platform === 'chesscom' ? `https://www.chess.com/member/${encodeURIComponent(username)}` : `https://lichess.org/@/${encodeURIComponent(username)}`;
}

export function downloadHelp(platform, username) {
  return platform === 'chesscom'
    ? { url: `https://www.chess.com/games/archive/${encodeURIComponent(username)}`, text: 'On Chess.com, open your game archive, select games and use Download.' }
    : { url: `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=300&perfType=bullet,blitz,rapid&clocks=true&opening=true`, text: 'This link downloads your recent games from Lichess as a file.' };
}
