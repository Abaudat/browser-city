#!/usr/bin/env node
// team-usage.mjs -- a terminal dashboard of the agentic team's Claude usage.
//
//   node scripts/team-usage.mjs                       interactive; keys are on screen
//   node scripts/team-usage.mjs --once --period week  print one frame and exit
//   node scripts/team-usage.mjs --help
//
// Every role session the orchestrator starts is a Claude Code session, and
// Claude Code writes each one to ~/.claude/projects/<worktree>/<session>.jsonl
// (plus <session>/subagents/*.jsonl for the agents it forks). Each assistant
// line in those files carries the model and the token usage the API reported
// for that call. This script sums them -- nothing else: no network, no gh, no
// Claude, only node and the files already on disk. It re-reads them every
// RELOAD_MS while it is open.
//
// Who spent what is read from what each session recorded about itself:
//   - `agent-setting` -> the role (`claude --agent crew`, see lib/claude.sh)
//   - `custom-title`  -> "bc-crew #316 (f205f9d1)", the -n name bc-session.sh
//                        gives it; the issue (or Scotty's sprint) comes from here
// Sessions with neither are Adrian's own; they are shown as role "human" when
// [t]eam-only is switched off, under the worktree they ran in.
//
// Roles are coloured in three groups -- Crew, the leads, Scotty -- and the
// timeline and the per-issue bars are stacked by group, so what an issue cost
// to build and what it cost to review are visible side by side.
//
// A week here runs from Friday 11:00 to the next Friday 11:00 (WEEK_START),
// which is when the account's weekly rate-limit window resets, so the week
// panel reads as "this week's budget" and not as a calendar.
//
// Costs are estimates at Anthropic's published API rates (in PRICES below).
// The account is on a subscription, so the dollar figures measure weight,
// not a bill -- but they are the one number that makes an Opus call and a
// Sonnet call comparable, so they are the default metric.
//
// A parse cache in $BC_STATE_DIR (default ~/.browsercity) keeps re-reads
// cheap; a transcript is parsed again only when its size or mtime changed.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- options -----------------------------------------------------------------

const HELP = `usage: node scripts/team-usage.mjs [options]
  -p, --period day|week|month   period shown first (default: week)
      --once                    print one frame and exit (implied when stdout is not a terminal)
      --all                     include Adrian's own sessions, not only the team's
      --metric cost|tokens|output   the number bars and sorting use (default: cost)
      --projects <dir>          where the transcripts are (default: ~/.claude/projects)
      --match <text>            only project dirs whose name contains this (default: BrowserCity)
      --no-cache                ignore and do not write the parse cache
      --no-color                plain text
      --size <cols>x<rows>      render for this terminal size (with --once)
      --ascii                   no box-drawing or block characters
  -h, --help

keys (interactive): d/w/m period   <- -> previous/next period   n now
                    t team-only    c metric   j/k scroll issues   q quit
The screen re-reads the transcripts every 30 seconds on its own.`;

const opts = {
  period: 'week', once: false, all: false, metric: 'cost', color: true, ascii: false,
  cache: true, projects: null, match: 'BrowserCity', size: null,
};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '-p' || a === '--period') opts.period = next();
    else if (a === '--once') opts.once = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--metric') opts.metric = next();
    else if (a === '--projects') opts.projects = next();
    else if (a === '--match') opts.match = next();
    else if (a === '--no-cache') opts.cache = false;
    else if (a === '--size') { const m = /^(\d+)x(\d+)$/.exec(next()); if (!m) { console.error('team-usage: --size wants <cols>x<rows>'); process.exit(2); } opts.size = [+m[1], +m[2]]; }
    else if (a === '--no-color') opts.color = false;
    else if (a === '--ascii') opts.ascii = true;
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else { console.error(`team-usage: unknown option ${a}\n${HELP}`); process.exit(2); }
  }
  if (!['day', 'week', 'month'].includes(opts.period)) { console.error(`team-usage: --period must be day, week or month`); process.exit(2); }
  if (!['cost', 'tokens', 'output'].includes(opts.metric)) { console.error(`team-usage: --metric must be cost, tokens or output`); process.exit(2); }
  if (!process.stdout.isTTY) { opts.once = true; if (!process.env.FORCE_COLOR) opts.color = false; }
  if (process.env.NO_COLOR) opts.color = false;
}

const HOME = os.homedir();
const PROJECTS = opts.projects ?? path.join(HOME, '.claude', 'projects');
const STATE_DIR = process.env.BC_STATE_DIR ?? path.join(HOME, '.browsercity');
const CACHE_FILE = path.join(STATE_DIR, 'team-usage-cache.json');
const CACHE_VERSION = 1;
const RELOAD_MS = 30_000;
// The week window: weekday (0 = Sunday, 5 = Friday) and hour it starts on.
const WEEK_START = { day: 5, hour: 11 };

// --- roles and their groups --------------------------------------------------
// The three groups the graphs are coloured by. Everything that is not Crew or
// Scotty and came in with --agent is a lead; a session with no agent at all
// is Adrian's.
const LEADS = new Set(['quentin', 'derek', 'tim', 'artie']);
const GROUPS = [
  { id: 'crew', label: 'Crew', color: '34' },
  { id: 'leads', label: 'Leads', color: '32' },
  { id: 'scotty', label: 'Scotty', color: '33' },
  { id: 'other', label: 'Adrian', color: '35' },
];
const GROUP_BY_ID = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
function groupOf(role) {
  if (role === 'crew') return 'crew';
  if (role === 'scotty') return 'scotty';
  if (role === 'human') return 'other';
  return LEADS.has(role) ? 'leads' : (role ? 'leads' : 'other');
}

// --- prices, $ per million tokens ------------------------------------------
// [model id prefix, input, output, cache read, cache write 5m, cache write 1h]
// Anthropic API list prices as of 2026-06. Unknown models cost 0 and are
// flagged in the model panel, so a new model shows up as "unpriced" rather
// than as free.
const PRICES = [
  [/^claude-fable-5-1/, 10, 50, 0.25, 12.5, 20],
  [/^claude-(fable|mythos)-5/, 10, 50, 1, 12.5, 20],
  [/^claude-opus-(5|4-[678])/, 5, 25, 0.5, 6.25, 10],
  [/^claude-sonnet-5/, 2, 10, 0.2, 2.5, 4],
  [/^claude-sonnet-4-6/, 3, 15, 0.3, 3.75, 6],
  [/^claude-haiku-4-5/, 1, 5, 0.1, 1.25, 2],
];
const priceCache = new Map();
function priceOf(model) {
  let p = priceCache.get(model);
  if (p === undefined) {
    p = PRICES.find(([re]) => re.test(model)) ?? null;
    priceCache.set(model, p);
  }
  return p;
}
// A call is [t, model, input, output, cacheRead, cacheWrite5m, cacheWrite1h].
function costOf(c) {
  const p = priceOf(c[1]);
  if (!p) return 0;
  return (c[2] * p[1] + c[3] * p[2] + c[4] * p[3] + c[5] * p[4] + c[6] * p[5]) / 1e6;
}
const labelCache = new Map();
function modelLabel(model) { // claude-fable-5-1 -> fable 5.1, claude-haiku-4-5-20251001 -> haiku 4.5
  let l = labelCache.get(model);
  if (l === undefined) {
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?$/.exec(model);
    l = m ? `${m[1]} ${m[2]}${m[3] ? '.' + m[3] : ''}` : model;
    if (!priceOf(model)) l += ' (unpriced)';
    labelCache.set(model, l);
  }
  return l;
}

// --- transcripts -------------------------------------------------------------

function listSessions() {
  const out = [];
  let dirs;
  try { dirs = fs.readdirSync(PROJECTS); } catch { return out; }
  for (const d of dirs) {
    if (!d.includes(opts.match)) continue;
    const dir = path.join(PROJECTS, d);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const id = e.name.slice(0, -6);
      const subdir = path.join(dir, id, 'subagents');
      let subs = [];
      try {
        subs = fs.readdirSync(subdir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(subdir, f));
      } catch { /* no subagents */ }
      const slug = d.replace(/^.*BrowserCity-*/, '') || 'main';
      out.push({ id, slug, file: path.join(dir, e.name), subs });
    }
  }
  return out;
}

// One transcript -> its self-description and the API calls in it. The same
// API message is written once per content block (same message.id, same
// usage), so calls are keyed by id and counted once. Lines that cannot be an
// assistant line are skipped on a substring test before any JSON is parsed:
// the bulk of a transcript is tool output, and parsing it is what would make
// this slow.
function parseTranscript(file) {
  const meta = { agent: null, title: null };
  const byId = new Map();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { meta, calls: [] }; }
  let start = 0;
  const n = text.length;
  while (start < n) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = n;
    const line = text.slice(start, end);
    start = end + 1;
    if (line.length < 30) continue;
    if (line.startsWith('{"type":"')) {
      if (line.startsWith('{"type":"agent-setting"') || line.startsWith('{"type":"custom-title"')) {
        try {
          const o = JSON.parse(line);
          if (o.type === 'agent-setting' && o.agentSetting) meta.agent = String(o.agentSetting);
          if (o.type === 'custom-title' && o.customTitle) meta.title = String(o.customTitle);
        } catch { /* skip */ }
      }
      continue;
    }
    if (!line.includes('"type":"assistant"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'assistant' || !o.message) continue;
    const m = o.message;
    const u = m.usage;
    if (!u) continue;
    const model = String(m.model || '');
    if (!model || model.startsWith('<')) continue;
    const t = Date.parse(o.timestamp);
    if (!Number.isFinite(t)) continue;
    const cc = u.cache_creation || null;
    const cw5 = cc ? (cc.ephemeral_5m_input_tokens | 0) : (u.cache_creation_input_tokens | 0);
    const cw1 = cc ? (cc.ephemeral_1h_input_tokens | 0) : 0;
    byId.set(m.id || o.uuid, [t, model, u.input_tokens | 0, u.output_tokens | 0, u.cache_read_input_tokens | 0, cw5, cw1]);
  }
  return { meta, calls: [...byId.values()] };
}

function readCache() {
  if (!opts.cache) return {};
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return c.version === CACHE_VERSION && c.files ? c.files : {};
  } catch { return {}; }
}
function writeCache(files) {
  if (!opts.cache) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, files }));
    fs.renameSync(tmp, CACHE_FILE);
  } catch { /* a cache that cannot be written only costs the next run time */ }
}

function classify(s) {
  const title = s.meta.title || '';
  const m = /^bc-([a-z]+) #(\S+)/i.exec(title);
  let role = s.meta.agent || (m ? m[1] : null);
  let issue = m ? m[2] : null;
  if (!issue) {
    const im = /^issue-(\d+)$/.exec(s.slug);
    issue = im ? im[1] : s.slug;
  }
  if (/^\d+$/.test(issue)) issue = '#' + issue;
  role = (role || 'human').toLowerCase();
  return { role, group: groupOf(role), issue, team: !!(s.meta.agent || m) };
}

// The in-memory copy of the cache survives between reloads, so a reload is
// one stat per file plus the parse of whatever grew.
let cacheFiles = null;
function loadAll(onProgress) {
  const sessions = listSessions();
  if (!cacheFiles) cacheFiles = readCache();
  const fresh = {};
  const total = sessions.reduce((a, s) => a + 1 + s.subs.length, 0);
  let done = 0, reparsed = 0;
  const get = (file) => {
    let rec = null;
    try {
      const st = fs.statSync(file);
      const hit = cacheFiles[file];
      if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) rec = hit;
      else { rec = { size: st.size, mtime: st.mtimeMs, ...parseTranscript(file) }; reparsed++; }
    } catch { rec = { size: 0, mtime: 0, meta: { agent: null, title: null }, calls: [] }; }
    fresh[file] = rec;
    onProgress(++done, total, reparsed);
    return rec;
  };
  for (const s of sessions) {
    const main = get(s.file);
    s.meta = main.meta;
    s.calls = main.calls.slice();
    for (const f of s.subs) s.calls.push(...get(f).calls);
    Object.assign(s, classify(s));
  }
  const changed = reparsed > 0 || Object.keys(fresh).length !== Object.keys(cacheFiles).length;
  cacheFiles = fresh;
  if (changed) writeCache(fresh);
  return { sessions, files: total, reparsed };
}

// --- periods -----------------------------------------------------------------

const DAY = 86400e3;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const pad2 = (n) => String(n).padStart(2, '0');
const dmy = (d) => `${WD[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
// Which local calendar day (counted from `base`, itself a local midnight) a
// timestamp falls on, once the clock is shifted back by `hourOffset` hours --
// so that a day running 11:00 to 11:00 is one bucket, DST changes included.
const dayIndex = (base, t, hourOffset = 0) => Math.round((midnight(new Date(t - hourOffset * 3600e3)) - base) / DAY);

// The window shown: [start, end), its label, and how its timeline is cut.
function periodOf(kind, offset, now = new Date()) {
  const today = midnight(now);
  if (kind === 'day') {
    const start = addDays(today, offset);
    const end = addDays(start, 1);
    return {
      start, end,
      label: `Day · ${dmy(start)} ${start.getFullYear()}`,
      buckets: 24, bucketOf: (t) => Math.min(23, Math.max(0, Math.floor((t - start) / 3600e3))),
      bucketLabel: (i) => pad2(i), bucketUnit: 'hour',
    };
  }
  if (kind === 'week') {
    // The most recent WEEK_START before now, then `offset` weeks from it.
    let start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() - WEEK_START.day + 7) % 7), WEEK_START.hour);
    if (start > now) start = addDays(start, -7);
    start = addDays(start, offset * 7);
    const end = addDays(start, 7);
    const base = midnight(start);
    const hh = `${pad2(WEEK_START.hour)}:00`;
    return {
      start, end,
      label: `Week · ${dmy(start)} ${hh} – ${dmy(end)} ${hh} ${end.getFullYear()}`,
      buckets: 7, bucketOf: (t) => Math.min(6, Math.max(0, dayIndex(base, t, WEEK_START.hour))),
      bucketLabel: (i) => { const d = addDays(start, i); return `${WD[d.getDay()]} ${d.getDate()}`; },
      bucketUnit: `day from ${hh}`,
    };
  }
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const end = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const days = Math.round((end - first) / DAY);
  return {
    start: first, end,
    label: `Month · ${MONTHS[first.getMonth()]} ${first.getFullYear()}`,
    buckets: days, bucketOf: (t) => Math.min(days - 1, Math.max(0, dayIndex(first, t))),
    bucketLabel: (i) => String(i + 1), bucketUnit: 'day',
  };
}

// --- aggregation -------------------------------------------------------------

const zeroSub = () => ({ calls: 0, in: 0, out: 0, cr: 0, cw: 0, cost: 0 });
const zero = () => ({ ...zeroSub(), who: new Set(), groups: {} });
function acc(st, c, cost) {
  st.calls++; st.in += c[2]; st.out += c[3]; st.cr += c[4]; st.cw += c[5] + c[6]; st.cost += cost;
}
function add(st, c, cost, role, group) {
  acc(st, c, cost);
  st.who.add(role);
  acc(st.groups[group] ??= zeroSub(), c, cost);
}
const tokensOf = (st) => st.in + st.out + st.cr + st.cw;
const METRICS = {
  cost: { label: 'est. $', of: (st) => st.cost, fmt: (v) => fmtMoney(v) },
  tokens: { label: 'tokens', of: (st) => tokensOf(st), fmt: (v) => fmtNum(v) },
  output: { label: 'output', of: (st) => st.out, fmt: (v) => fmtNum(v) },
};
// A stat's metric split by group, in GROUPS order (zeros included).
const splitOf = (st, M) => GROUPS.map((g) => (st.groups[g.id] ? M.of(st.groups[g.id]) : 0));

function aggregate(sessions, period, teamOnly) {
  const total = zero();
  const by = { role: new Map(), model: new Map(), issue: new Map() };
  const buckets = Array.from({ length: period.buckets }, zero);
  const active = new Set();
  const s0 = +period.start, s1 = +period.end;
  const grp = (map, key) => { let g = map.get(key); if (!g) { g = zero(); map.set(key, g); } return g; };
  for (const s of sessions) {
    if (teamOnly && !s.team) continue;
    let touched = false;
    for (const c of s.calls) {
      const t = c[0];
      if (t < s0 || t >= s1) continue;
      touched = true;
      const cost = costOf(c);
      add(total, c, cost, s.role, s.group);
      add(grp(by.role, s.role), c, cost, s.role, s.group);
      add(grp(by.model, modelLabel(c[1])), c, cost, s.role, s.group);
      add(grp(by.issue, s.issue), c, cost, s.role, s.group);
      add(buckets[period.bucketOf(t)], c, cost, s.role, s.group);
    }
    if (touched) active.add(s.id);
  }
  return { total, by, buckets, sessions: active.size };
}

// --- formatting --------------------------------------------------------------

const ANSI = /\x1b\[[0-9;]*m/g;
const vis = (s) => s.replace(ANSI, '').length;
const col = (code, s) => (opts.color ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => col('2', s);
const bold = (s) => col('1', s);
const key = (s) => (opts.color ? col('36', s) : `[${s}]`);
const warn = (s) => col('33', s);
const gcol = (groupId, s) => col(GROUP_BY_ID[groupId]?.color ?? '0', s);
const roleName = (role) => gcol(groupOf(role), role);
const padR = (s, w) => { const n = vis(s); return n >= w ? s : s + ' '.repeat(w - n); };
const padL = (s, w) => { const n = vis(s); return n >= w ? s : ' '.repeat(w - n) + s; };
function trunc(s, w) { // plain strings only
  if (s.length <= w) return s;
  return w <= 1 ? s.slice(0, w) : s.slice(0, w - 1) + (opts.ascii ? '~' : '…');
}
function fmtNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k';
  return String(Math.round(n));
}
function fmtMoney(v) {
  if (v >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'k';
  if (v >= 100) return '$' + Math.round(v).toLocaleString('en-US');
  if (v >= 1) return '$' + v.toFixed(2);
  if (v > 0) return '$' + v.toFixed(3);
  return '$0';
}
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) + '%' : '–');
const hms = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

const G = opts.ascii
  ? { h: '-', bar: '#', barDim: ' ', blocks: ' ,:;|iI#', axis: '|', swatch: '#' }
  : { h: '─', bar: '█', barDim: ' ', blocks: ' ▁▂▃▄▅▆▇█', axis: '┤', swatch: '■' };

function rule(title, W, right = '') {
  const t = title ? ` ${title} ` : '';
  const r = right ? ` ${right} ` : '';
  const left = G.h.repeat(2);
  const mid = G.h.repeat(Math.max(0, W - 2 - vis(t) - vis(r)));
  return dim(left) + bold(t) + dim(mid) + r;
}
function legend(groups) {
  return groups.map((g) => gcol(g.id, G.swatch) + ' ' + g.label).join('  ');
}
// A bar of `w` cells for a stat worth `share` of the panel, stacked by group.
function groupBar(st, share, w, M) {
  const filled = Math.round(share * w);
  const parts = splitOf(st, M);
  const sum = parts.reduce((a, b) => a + b, 0);
  let out = '', used = 0, cum = 0;
  GROUPS.forEach((g, i) => {
    cum += parts[i];
    const upto = sum > 0 ? Math.round((cum / sum) * filled) : 0;
    const n = Math.max(0, upto - used);
    if (n > 0) out += gcol(g.id, G.bar.repeat(n));
    used += n;
  });
  return out + G.barDim.repeat(Math.max(0, w - used)); // the unfilled part stays blank: a hatched filler flickers on every redraw
}

// --- panels ------------------------------------------------------------------

function tiles(agg, W) {
  const t = agg.total;
  const items = [
    ['est. cost', fmtMoney(t.cost)],
    ['tokens', fmtNum(tokensOf(t))],
    ['output', fmtNum(t.out)],
    ['API calls', fmtInt(t.calls)],
    ['sessions', fmtInt(agg.sessions)],
    ['cache hit', pct(t.cr, t.in + t.cr + t.cw)],
  ];
  const perRow = Math.max(1, Math.min(items.length, Math.floor(W / 12)));
  const w = Math.min(22, Math.floor(W / perRow));
  const lines = [];
  for (let i = 0; i < items.length; i += perRow) {
    const chunk = items.slice(i, i + perRow);
    lines.push(chunk.map(([l]) => padR('  ' + dim(l), w)).join(''));
    lines.push(chunk.map(([, v]) => padR('  ' + bold(v), w)).join(''));
  }
  return lines;
}

// Stacked bars: each bucket is a column of H rows, eight levels a row, filled
// bottom-up with one group's colour after the other in GROUPS order. A row
// that straddles two groups takes the colour of the group at the middle of
// its filled part -- the cells are too small for a finer split to read.
function chart(agg, period, metric, W, H, groups) {
  const M = METRICS[metric];
  const splits = agg.buckets.map((st) => splitOf(st, M));
  const totals = splits.map((p) => p.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 0);
  const n = totals.length;
  const axisW = 8;
  const colW = Math.max(1, Math.floor((W - axisW) / n));
  const barW = colW <= 3 ? colW : Math.max(3, colW - Math.max(1, Math.floor(colW / 4)));
  const scale = max > 0 ? (H * 8) / max : 0;
  const lines = [rule(`Timeline · ${M.label} per ${period.bucketUnit}`, W, legend(groups))];
  for (let r = H - 1; r >= 0; r--) {
    const axis = r === H - 1 ? padL(M.fmt(max), axisW - 1) + G.axis : r === 0 ? padL('0', axisW - 1) + G.axis : ' '.repeat(axisW - 1) + G.axis;
    let row = dim(axis);
    for (let i = 0; i < n; i++) {
      const top = Math.round(totals[i] * scale);
      const fill = Math.max(0, Math.min(8, top - r * 8));
      const cell = G.blocks[fill].repeat(barW) + ' '.repeat(colW - barW);
      if (fill === 0) { row += cell; continue; }
      const mid = (r * 8 + fill / 2) / scale; // metric value at the row's middle
      let cum = 0, gi = 0;
      for (; gi < GROUPS.length - 1; gi++) { cum += splits[i][gi]; if (mid < cum) break; }
      row += gcol(GROUPS[gi].id, cell);
    }
    lines.push(row);
  }
  const labels = Array.from({ length: n }, (_, i) => period.bucketLabel(i));
  const maxLabel = Math.max(...labels.map((l) => l.length));
  const step = Math.max(1, Math.ceil((maxLabel + 1) / colW));
  let lab = ' '.repeat(axisW);
  for (let i = 0; i < n; i += step) lab += padR(labels[i], colW * step);
  lines.push(dim(lab.slice(0, W)));
  return lines;
}

// A breakdown table. Columns are chosen by width; the bar is whatever is left.
function table(title, map, metric, W, maxRows, scroll, kind) {
  const M = METRICS[metric];
  const rows = [...map.entries()].sort((a, b) => M.of(b[1]) - M.of(a[1]) || tokensOf(b[1]) - tokensOf(a[1]));
  const sum = rows.reduce((a, [, st]) => a + M.of(st), 0);
  const nameW = Math.max(6, Math.min(18, Math.max(0, ...rows.map(([k]) => k.length)), Math.floor(W / 4)));
  const name = kind === 'role' ? (k) => roleName(trunc(k, nameW)) : (k) => trunc(k, nameW);
  const who = (st) => {
    const names = [...st.who].sort();
    const shown = trunc(names.join(', '), 18).split(', ');
    return shown.map((p) => { const full = names.find((r) => r.startsWith(p.replace(/[…~]$/, ''))) ?? p; return gcol(groupOf(full), p); }).join(', ');
  };
  const all = [
    { h: title, w: nameW, l: true, get: name },
    { h: 'calls', w: 6, get: (_, st) => fmtInt(st.calls), key: 'calls' },
    { h: 'input', w: 7, get: (_, st) => fmtNum(st.in) },
    { h: 'cache rd', w: 8, get: (_, st) => fmtNum(st.cr) },
    { h: 'cache wr', w: 8, get: (_, st) => fmtNum(st.cw) },
    { h: 'output', w: 7, get: (_, st) => fmtNum(st.out), key: 'output' },
    { h: 'tokens', w: 7, get: (_, st) => fmtNum(tokensOf(st)), key: 'tokens' },
    { h: 'est. $', w: 8, get: (_, st) => fmtMoney(st.cost), key: 'cost' },
    { h: 'share', w: 5, get: (_, st) => pct(M.of(st), sum) },
  ];
  if (kind === 'issue') all.push({ h: 'who', w: 18, l: true, get: (_, st) => who(st) });
  const width = (cols) => cols.reduce((a, c) => a + c.w + 1, 0);
  let cols = all;
  const drop = (h) => { cols = cols.filter((c) => c.h !== h); };
  const barMin = 8;
  const order = ['cache wr', 'cache rd', 'input', 'who', 'calls', 'output', 'tokens', 'share'];
  for (const h of order) {
    if (width(cols) + barMin <= W) break;
    if (h === METRICS[metric].label) continue; // never drop the metric column
    drop(h);
  }
  const barW = Math.max(0, W - width(cols) - 1);
  const cell = (c, s, head) => {
    let v = head ? c.h : s;
    if (head && c.key === metric) v = col('4', v);
    return c.l ? padR(v, c.w) : padL(v, c.w);
  };
  const lines = [rule(title, W)];
  lines.push(dim(cols.map((c) => cell(c, null, true)).join(' ')));
  if (rows.length === 0) { lines.push(dim('  nothing in this period')); return { lines, total: 0, shown: 0 }; }
  const n = Math.max(1, maxRows);
  const from = Math.max(0, Math.min(scroll, rows.length - n));
  const slice = rows.slice(from, from + n);
  for (const [k, st] of slice) {
    let line = cols.map((c) => cell(c, c.get(k, st), false)).join(' ');
    if (barW >= barMin) line += ' ' + groupBar(st, sum > 0 ? M.of(st) / sum : 0, barW, M);
    lines.push(line);
  }
  if (rows.length > n) {
    const after = rows.length - from - slice.length;
    lines.push(dim(`  ${from > 0 ? `↑ ${from} above  ` : ''}${after > 0 ? `↓ ${after} more` : ''}  (${rows.length} total, j/k to scroll)`));
  }
  return { lines, total: rows.length, shown: slice.length, from };
}

// --- the frame ---------------------------------------------------------------

function frame(state, cols, rows) {
  const W = Math.max(40, cols);
  const period = periodOf(state.period, state.offset);
  const agg = aggregate(state.sessions, period, state.teamOnly);
  const groups = GROUPS.filter((g) => g.id !== 'other' || !state.teamOnly);
  const out = [];

  // header: the period keys, the one in force shown in reverse video
  const title = bold('BrowserCity · team usage');
  const plabel = bold(period.label) + (state.offset === 0 ? '' : dim(`  (${-state.offset} ${state.period}${state.offset === -1 ? '' : 's'} ago)`));
  out.push(padR(' ' + title + '   ' + plabel, W));
  const pk = (k, name) => (state.period === name
    ? (opts.color ? col('7', ` ${k}${name.slice(1)} `) : name.toUpperCase())
    : key(k) + name.slice(1));
  const keys = [
    `${pk('d', 'day')} ${pk('w', 'week')} ${pk('m', 'month')}`, `${key('←')}/${key('→')} shift`, `${key('n')}ow`,
    `${key('t')}eam-only ${state.teamOnly ? bold('on') : dim('off')}`, `${key('c')} metric: ${bold(METRICS[state.metric].label)}`,
    `${key('j')}/${key('k')} scroll`, `${key('q')}uit`,
  ];
  let kl = ' ';
  for (const k of keys) { if (vis(kl) + vis(k) + 3 > W) break; kl += k + '   '; }
  out.push(dim(padR(kl, W)));

  // budget the height: header 2, tiles, chart, role+model, issue, footer 1.
  const tileLines = tiles(agg, W);
  const sideBySide = W >= 110;
  const nRole = agg.by.role.size, nModel = agg.by.model.size;
  let chartH = Math.max(2, Math.min(6, Math.floor(rows / 8)));
  let capSide = 8;
  const need = (ch, cap) => {
    const side = sideBySide
      ? 2 + Math.min(cap, Math.max(nRole, nModel, 1)) + (Math.max(nRole, nModel) > cap ? 1 : 0)
      : 4 + Math.min(cap, Math.max(nRole, 1)) + Math.min(cap, Math.max(nModel, 1)) + (nRole > cap ? 1 : 0) + (nModel > cap ? 1 : 0);
    return 2 + tileLines.length + (ch > 0 ? ch + 2 : 0) + side + 3 + 1;
  };
  let issueRows = rows - need(chartH, capSide);
  if (issueRows < 4) { chartH = 1; issueRows = rows - need(chartH, capSide); }
  if (issueRows < 4) { capSide = 4; issueRows = rows - need(chartH, capSide); }
  if (issueRows < 3) { chartH = 0; issueRows = rows - need(chartH, capSide); }
  issueRows = Math.max(1, issueRows);

  out.push(...tileLines);
  if (chartH > 0) out.push(...chart(agg, period, state.metric, W, chartH, groups));

  const roleT = table('By role', agg.by.role, state.metric, sideBySide ? Math.floor((W - 3) / 2) : W, capSide, 0, 'role');
  const modelT = table('By model', agg.by.model, state.metric, sideBySide ? W - 3 - Math.floor((W - 3) / 2) : W, capSide, 0, 'model');
  if (sideBySide) {
    const lw = Math.floor((W - 3) / 2);
    const h = Math.max(roleT.lines.length, modelT.lines.length);
    for (let i = 0; i < h; i++) out.push(padR(roleT.lines[i] ?? '', lw) + '   ' + (modelT.lines[i] ?? ''));
  } else {
    out.push(...roleT.lines, ...modelT.lines);
  }

  const issueT = table('By issue', agg.by.issue, state.metric, W, issueRows, state.scroll, 'issue');
  out.push(...issueT.lines);
  state.scrollMax = Math.max(0, issueT.total - issueT.shown);
  if (state.scroll > state.scrollMax) state.scroll = state.scrollMax;

  // footer
  const unpriced = [...agg.by.model.keys()].filter((k) => k.endsWith('(unpriced)'));
  const foot = ' ' + dim(`${state.files} transcripts under ${PROJECTS}` + (state.loadedAt ? `, read ${state.loadedAt}` : '')
    + (opts.once ? '' : `, re-read every ${RELOAD_MS / 1000}s`))
    + (unpriced.length ? '  ' + warn(`no price for ${unpriced.join(', ')}`) : '');
  while (out.length < rows - 1) out.push('');
  out.length = Math.min(out.length, rows - 1);
  out.push(foot);
  return out.map((l) => (vis(l) > W ? clip(l, W) : l));
}
// Clip a line with ANSI codes to W visible columns.
function clip(line, W) {
  let outp = '', n = 0, i = 0;
  while (i < line.length && n < W) {
    if (line[i] === '\x1b') { const m = /^\x1b\[[0-9;]*m/.exec(line.slice(i)); if (m) { outp += m[0]; i += m[0].length; continue; } }
    outp += line[i++]; n++;
  }
  return outp + (opts.color ? '\x1b[0m' : '');
}

// --- run ---------------------------------------------------------------------

const state = {
  period: opts.period, offset: 0, teamOnly: !opts.all, metric: opts.metric, scroll: 0, scrollMax: 0,
  sessions: [], files: 0, reparsed: 0, loadedAt: '', onScreen: false,
};

function load() {
  const t0 = Date.now();
  let last = 0;
  const { sessions, files, reparsed } = loadAll((done, total, re) => {
    if (opts.once || state.onScreen || Date.now() - last < 100) return;
    last = Date.now();
    process.stdout.write(`\r\x1b[K reading transcripts ${done}/${total}${re ? ` (${re} changed)` : ''}…`);
  });
  state.sessions = sessions; state.files = files; state.reparsed = reparsed;
  state.loadedAt = `${hms(new Date())} in ${((Date.now() - t0) / 1000).toFixed(1)}s` + (reparsed ? ` (${reparsed} changed)` : '');
  if (!opts.once && !state.onScreen) process.stdout.write('\r\x1b[K');
}

if (opts.once) {
  load();
  const cols = opts.size?.[0] || process.stdout.columns || 120;
  const rows = opts.size?.[1] || process.stdout.rows || 45;
  process.stdout.write(frame(state, cols, rows).join('\n') + '\n');
  process.exit(0);
}

load();
const out = process.stdout;
// A Windows console decodes what is written to it in its own code page, and
// a fresh PowerShell's is the OEM one, which turns every box and block
// character into two of something else. chcp on the attached console switches
// it to UTF-8 for this process's lifetime; a failure only costs the glyphs.
if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'ignore', windowsHide: true }); } catch { /* keep going */ }
}
out.write('\x1b[?1049h\x1b[?25l'); // alternate screen, no cursor
state.onScreen = true;
const restore = () => { out.write('\x1b[0m\x1b[?25h\x1b[?1049l'); };
const quit = () => { restore(); process.exit(0); };
process.on('exit', restore);
process.on('SIGINT', quit);
process.on('SIGTERM', quit);

function draw() {
  const lines = frame(state, out.columns || 80, out.rows || 24);
  out.write('\x1b[H' + lines.map((l) => l + '\x1b[K').join('\n') + '\x1b[J');
}
draw();
out.on('resize', draw);
setInterval(() => { load(); draw(); }, RELOAD_MS);

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (k) => {
  switch (k) {
    case 'q': case 'Q': case '\x03': case '\x04': quit(); return;
    case 'd': state.period = 'day'; state.offset = 0; state.scroll = 0; break;
    case 'w': state.period = 'week'; state.offset = 0; state.scroll = 0; break;
    case 'm': state.period = 'month'; state.offset = 0; state.scroll = 0; break;
    case '\x1b[D': case 'h': case '[': case '\x1b[1;5D': state.offset--; state.scroll = 0; break;
    case '\x1b[C': case 'l': case ']': case '\x1b[1;5C': if (state.offset < 0) { state.offset++; state.scroll = 0; } break;
    case 'n': case '0': state.offset = 0; state.scroll = 0; break;
    case 't': state.teamOnly = !state.teamOnly; state.scroll = 0; break;
    case 'c': { const ks = Object.keys(METRICS); state.metric = ks[(ks.indexOf(state.metric) + 1) % ks.length]; break; }
    case 'j': case '\x1b[B': state.scroll = Math.min(state.scrollMax, state.scroll + 1); break;
    case 'k': case '\x1b[A': state.scroll = Math.max(0, state.scroll - 1); break;
    case '\x1b[6~': state.scroll = Math.min(state.scrollMax, state.scroll + 10); break; // PgDn
    case '\x1b[5~': state.scroll = Math.max(0, state.scroll - 10); break; // PgUp
    case 'g': state.scroll = 0; break;
    case 'G': state.scroll = state.scrollMax; break;
    default: return;
  }
  draw();
});
