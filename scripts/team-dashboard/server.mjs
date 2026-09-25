#!/usr/bin/env node
// team-dashboard/server.mjs -- a live web dashboard of the agentic team.
//
//   node scripts/team-dashboard/server.mjs            serves on 0.0.0.0:4747
//   BC_DASHBOARD_PORT=8080 node scripts/team-dashboard/server.mjs
//
// One page (index.html beside this file) polling one endpoint (/api/state).
// Everything on it is read from what already exists on this machine -- the
// same sources the orchestrator and team-usage.mjs read, never a store of its
// own except one small history file:
//
//   who is working    `orca terminal list`: every role session is an Orca
//                     terminal titled "<glyph> bc-<role> #<issue> (<uuid8>)",
//                     and the glyph is Claude's own state -- the rule
//                     bc-session.sh's _bc_glyph_word applies (✳ idle, else working)
//   the budget        `claude-rate-monitor --json`, the call bc-budget.sh makes;
//                     each answer is appended to $BC_STATE_DIR/usage-history.jsonl,
//                     which is what the usage-over-time graph draws
//   the task, the PR  the Project v2 board and the PR's comments, through `gh`
//                     -- the same fields and markers bc-issue.sh / bc-comment.sh read
//   the loop          $BC_STATE_DIR/orchestrator.log, the file run-orchestrator.sh tees to
//   spend per role    the Claude Code transcripts, summed the way team-usage.mjs does
//
// Each source refreshes on its own clock (SOURCES below), so a slow `gh` never
// holds up the sprites. A source that fails keeps its last good answer and
// says so in `errors`, rather than blanking the page.
//
// The week runs Friday 11:00 to Friday 11:00 local time: the account's weekly
// rate-limit reset, and team-usage.mjs's week.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const HOME = os.homedir();
const STATE_DIR = process.env.BC_STATE_DIR ?? path.join(HOME, '.browsercity');
const PORT = Number(process.env.BC_DASHBOARD_PORT ?? 4747);
const HOST = process.env.BC_DASHBOARD_HOST ?? '0.0.0.0';

const REPO = process.env.BC_REPO ?? 'Abaudat/browser-city';
const OWNER = process.env.BC_PROJECT_OWNER ?? 'Abaudat';
const PROJECT = Number(process.env.BC_PROJECT_NUMBER ?? 1);
const SESSION_CAP = Number(process.env.BC_SESSION_CAP ?? 0.85);
const WEEKLY_CAP = Number(process.env.BC_WEEKLY_CAP ?? 0.80);
const ENDGAME_HOURS = Number(process.env.BC_WEEKLY_ENDGAME_HOURS ?? 12);
const CYCLE_LIMIT = Number(process.env.BC_CYCLE_LIMIT ?? 8);
const IDLE_MS = Number(process.env.BC_IDLE_MS ?? 300000);
const LOOP_INTERVAL_S = Number(process.env.BC_LOOP_INTERVAL_S ?? 180);
const WEEK_START = { day: 5, hour: 11 };

const ROLES = ['scotty', 'crew', 'tim', 'derek', 'quentin', 'artie'];
const LEADS = ['quentin', 'derek', 'tim', 'artie'];

// --- tools ---------------------------------------------------------------------
// Resolved by absolute path first, like lib/paths.sh: this may be started from
// an environment whose PATH predates the installs.

const LOCAL = process.env.LOCALAPPDATA ?? path.join(HOME, 'AppData', 'Local');
const ROAMING = process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming');
const firstExisting = (cands, fallback) => cands.find((c) => c && fs.existsSync(c)) ?? fallback;
const GH = firstExisting(['C:/Program Files/GitHub CLI/gh.exe', path.join(LOCAL, 'Programs/GitHub CLI/gh.exe')], 'gh');
const ORCA = firstExisting([path.join(LOCAL, 'Programs/orca/resources/bin/orca.exe')], 'orca');
// The monitor's npm shim is a .cmd, which execFile will not run without a
// shell; its package entry point is plain node, so that is what is run.
const RATE_MONITOR = firstExisting([
  process.env.BC_RATE_MONITOR_JS,
  path.join(ROAMING, 'npm/node_modules/claude-rate-monitor/index.js'),
], null);

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(cmd)} ${args[0] ?? ''}: ${(stderr || err.message).toString().trim().slice(0, 300)}`));
      else resolve(stdout.toString());
    });
  });
}
const runJson = async (cmd, args, timeout) => JSON.parse(await run(cmd, args, timeout));

// --- time ----------------------------------------------------------------------

const HOUR = 3600e3;
const DAY = 24 * HOUR;
function weekStartOf(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() - WEEK_START.day + 7) % 7), WEEK_START.hour);
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}

// --- state ---------------------------------------------------------------------

const state = {
  startedAt: Date.now(),
  sessions: null,     // { roles: {role: {...}}, loopTerminal: bool, at }
  budget: null,       // the last rate-monitor answer, normalised
  budgetHistory: [],  // [{t, s, w}]
  board: null,        // task, PR, KPIs from GitHub
  loop: null,         // the orchestrator log, parsed
  spend: null,        // per-role spend from transcripts
  errors: {},         // source -> { message, at }
};

// --- source: Orca terminals -> who is working -----------------------------------

const TITLE_RE = /^(?:(\S)\s+)?bc-([a-z]+) #(\S+) \(([0-9a-f]{8})\)/i;
function glyphWord(glyph, lastOutputAt) {
  if (glyph === '✳') return 'idle';
  if (glyph) return 'working';
  // No glyph yet: Claude is still booting and the title is the bare -n name.
  return lastOutputAt && Date.now() - lastOutputAt < IDLE_MS ? 'working' : 'idle';
}
async function readSessions() {
  const out = await runJson(ORCA, ['terminal', 'list', '--json'], 15000);
  if (!out.ok) throw new Error(`orca terminal list: ${out.error?.message ?? 'not ok'}`);
  const roles = Object.fromEntries(ROLES.map((r) => [r, { state: 'off', sessions: [] }]));
  let loopTerminal = false;
  for (const t of out.result?.terminals ?? []) {
    const title = t.title ?? '';
    if (title === 'bc-orchestrator') loopTerminal = true;
    const m = TITLE_RE.exec(title);
    if (!m || t.orphaned) continue;
    const role = m[2].toLowerCase();
    if (!roles[role]) continue;
    const word = glyphWord(m[1], t.lastOutputAt);
    roles[role].sessions.push({ issue: m[3], uuid8: m[4], state: word, lastOutputAt: t.lastOutputAt ?? null, worktree: t.worktreePath ?? null });
  }
  for (const r of Object.values(roles)) {
    r.sessions.sort((a, b) => (b.lastOutputAt ?? 0) - (a.lastOutputAt ?? 0));
    r.state = r.sessions.some((s) => s.state === 'working') ? 'working' : r.sessions.length ? 'idle' : 'off';
    const lead = r.sessions.find((s) => s.state === r.state) ?? r.sessions[0];
    r.issue = lead?.issue ?? null;
    r.lastOutputAt = lead?.lastOutputAt ?? null;
  }
  state.sessions = { roles, loopTerminal, at: Date.now() };
}

// --- source: the rate monitor -> usage percent, and its history -----------------

const HISTORY_FILE = path.join(STATE_DIR, 'usage-history.jsonl');
function loadHistory() {
  try {
    const cutoff = Date.now() - 15 * DAY;
    state.budgetHistory = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((p) => p && p.t >= cutoff);
  } catch { state.budgetHistory = []; }
}
async function readBudget() {
  if (!RATE_MONITOR) throw new Error('claude-rate-monitor not found under %APPDATA%/npm');
  const j = await runJson(process.execPath, [RATE_MONITOR, '--json'], 30000);
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const s = num(j.session?.utilization), w = num(j.weekly?.utilization);
  if (s === null || w === null) throw new Error(`rate monitor answered without utilisation: ${JSON.stringify(j).slice(0, 200)}`);
  const weeklyReset = num(j.weekly?.reset) ? num(j.weekly.reset) * 1000 : null;
  const endgame = !!weeklyReset && ENDGAME_HOURS > 0 && weeklyReset > Date.now() && weeklyReset - Date.now() < ENDGAME_HOURS * HOUR;
  state.budget = {
    at: Date.now(),
    overall: j.overallStatus ?? null,
    session: { util: s, reset: num(j.session?.reset) ? num(j.session.reset) * 1000 : null, status: j.session?.status ?? null, cap: SESSION_CAP },
    weekly: { util: w, reset: weeklyReset, status: j.weekly?.status ?? null, cap: endgame ? 1 : WEEKLY_CAP, baseCap: WEEKLY_CAP, endgame },
  };
  const point = { t: Date.now(), s, w };
  state.budgetHistory.push(point);
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.appendFileSync(HISTORY_FILE, JSON.stringify(point) + '\n'); } catch { /* the graph only loses a point */ }
}

// --- source: GitHub -> the task, its PR, the week's KPIs ------------------------

const gql = (query, vars = {}) => runJson(GH, ['api', 'graphql', '-f', `query=${query}`,
  ...Object.entries(vars).flatMap(([k, v]) => ['-F', `${k}=${v}`])], 60000);

const ITEMS_Q = `query($owner:String!,$number:Int!,$cursor:String){ user(login:$owner){ projectV2(number:$number){
  items(first:100, after:$cursor){ pageInfo{ hasNextPage endCursor } nodes{
    content{ ... on Issue { number title url state createdAt closedAt
      labels(first:20){ nodes{ name } } parent{ number title url } subIssues(first:1){ totalCount }
      blockedBy(first:20){ nodes{ state } } } }
    status: fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue{ name } }
    priority: fieldValueByName(name:"Priority"){ ... on ProjectV2ItemFieldSingleSelectValue{ name } }
    size: fieldValueByName(name:"Size"){ ... on ProjectV2ItemFieldSingleSelectValue{ name } }
    sprint: fieldValueByName(name:"Sprint"){ ... on ProjectV2ItemFieldIterationValue{ title startDate duration } } } }
  field(name:"Sprint"){ ... on ProjectV2IterationField{ configuration{ iterations{ title startDate duration } } } } } } }`;

async function projectItems() {
  const items = [];
  let cursor = null, sprints = [];
  for (let page = 0; page < 20; page++) {
    const j = await gql(ITEMS_Q, { owner: OWNER, number: PROJECT, ...(cursor ? { cursor } : {}) });
    const p = j.data.user.projectV2;
    sprints = p.field?.configuration?.iterations ?? sprints;
    for (const n of p.items.nodes) {
      const c = n.content;
      if (!c || !c.number) continue;
      items.push({
        number: c.number, title: c.title, url: c.url, state: c.state, createdAt: c.createdAt, closedAt: c.closedAt,
        labels: c.labels.nodes.map((l) => l.name), parent: c.parent, isParent: c.subIssues.totalCount > 0,
        blocked: c.blockedBy.nodes.some((b) => b.state === 'OPEN'),
        status: n.status?.name ?? null, priority: n.priority?.name ?? null, size: n.size?.name ?? null, sprint: n.sprint ?? null,
      });
    }
    if (!p.items.pageInfo.hasNextPage) break;
    cursor = p.items.pageInfo.endCursor;
  }
  return { items, sprints };
}

// `<!-- bc:name value -->`, the vocabulary lib/markers.sh owns.
const marker = (body, name) => {
  const m = new RegExp(`<!-- bc:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: ([^>]*?))? -->`).exec(body ?? '');
  return m ? (m[1] ?? '') : null;
};
const leadOf = (body) => /<!-- bc:lead:([a-z]+) -->/.exec(body ?? '')?.[1] ?? null;

const PR_Q = `query($owner:String!,$name:String!,$number:Int!){ repository(owner:$owner,name:$name){
  pullRequest(number:$number){ number title url state isDraft createdAt mergedAt additions deletions changedFiles headRefOid
    commits(last:1){ nodes{ commit{ statusCheckRollup{ state } } } }
    comments(first:100){ nodes{ body } } } } }`;
const ISSUE_COMMENTS_Q = `query($owner:String!,$name:String!,$number:Int!){ repository(owner:$owner,name:$name){
  issue(number:$number){ comments(first:100){ nodes{ body } } } } }`;

async function readBoard() {
  const [owner, name] = REPO.split('/');
  const { items, sprints } = await projectItems();
  const now = new Date();
  const weekStart = weekStartOf(now);
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const isStory = (i) => !i.isParent && !i.labels.includes('demo') && !i.labels.includes('epic');
  const ACTIVE = ['To analyze', 'In progress', 'Leads review', 'Reviewed'];
  const current = items.find((i) => isStory(i) && ACTIVE.includes(i.status)) ?? null;

  const counts = {};
  for (const i of items) if (isStory(i)) counts[i.status ?? 'None'] = (counts[i.status ?? 'None'] ?? 0) + 1;
  const backlog = items.filter((i) => isStory(i) && i.status === 'Backlog' && i.state === 'OPEN');
  const doneIn = (a, b) => items.filter((i) => isStory(i) && i.status === 'Done' && i.closedAt && new Date(i.closedAt) >= a && new Date(i.closedAt) < b)
    .sort((x, y) => new Date(y.closedAt) - new Date(x.closedAt));
  const doneWeek = doneIn(weekStart, new Date(8.64e15));
  const donePrev = doneIn(prevWeekStart, weekStart);

  // Stories done per week, the last eight weeks, for the tile's trend.
  const weekly = [];
  for (let k = 7; k >= 0; k--) {
    const a = new Date(weekStart); a.setDate(a.getDate() - 7 * k);
    const b = new Date(a); b.setDate(b.getDate() + 7);
    weekly.push({ start: a.getTime(), n: doneIn(a, b).length });
  }

  // An iteration runs from its start date's local midnight for `duration` days.
  const sprintOf = (sp) => {
    const [y, m, d] = sp.startDate.split('-').map(Number);
    return { title: sp.title, start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + sp.duration).getTime() };
  };
  const sprint = sprints.map(sprintOf).find((sp) => sp.start <= now.getTime() && now.getTime() < sp.end) ?? null;
  const demo = items.find((i) => i.labels.includes('demo') && i.state === 'OPEN') ?? null;

  let task = null, pr = null;
  if (current) {
    const scope = current.labels.filter((l) => l.startsWith('lead:')).map((l) => l.slice(5));
    task = {
      number: current.number, title: current.title, url: current.url, status: current.status,
      priority: current.priority, size: current.size, epic: current.parent ?? null, scope,
      directions: {}, createdAt: current.createdAt,
    };
    const ic = await gql(ISSUE_COMMENTS_Q, { owner, name, number: current.number });
    for (const c of ic.data.repository.issue.comments.nodes) {
      const lead = leadOf(c.body);
      const d = marker(c.body, 'direction');
      if (lead && d !== null) task.directions[lead] = d || 'PENDING';
    }
    if (!task.scope.length) task.scope = Object.keys(task.directions);
    // The PR that closes it: bc-pr.sh for-issue's search.
    const found = JSON.parse(await run(GH, ['pr', 'list', '--repo', REPO, '--state', 'all', '--search', `"Closes #${current.number}" in:body`, '--json', 'number,state', '--limit', '5']));
    const pick = found.find((p) => p.state === 'OPEN') ?? found[0];
    if (pick) {
      const pj = await gql(PR_Q, { owner, name, number: pick.number });
      const p = pj.data.repository.pullRequest;
      const reviews = {};
      let status = null, crew = null;
      for (const c of p.comments.nodes) {
        if (marker(c.body, 'status') !== null && marker(c.body, 'issue') !== null) status = c.body;
        const lead = leadOf(c.body);
        const reviewed = marker(c.body, 'reviewed');
        if (lead && reviewed !== null) {
          const verdict = marker(c.body, 'verdict');
          reviews[lead] = {
            verdict: reviewed === '-' || !reviewed ? 'PENDING' : (verdict || 'PENDING'),
            stale: !!reviewed && reviewed !== '-' && reviewed !== p.headRefOid,
          };
        }
        if (marker(c.body, 'crew') !== null) crew = marker(c.body, 'addressed');
      }
      // The scope the orchestrator stamped on the PR is the authority once
      // there is one; before that, whoever was asked for a direction.
      const scope = status ? (marker(status, 'scope') ?? '').split(/[ ,]+/).filter(Boolean) : [];
      if (scope.length) task.scope = scope;
      pr = {
        number: p.number, title: p.title, url: p.url, state: p.state, draft: p.isDraft, createdAt: p.createdAt,
        additions: p.additions, deletions: p.deletions, files: p.changedFiles, head: p.headRefOid.slice(0, 7),
        ci: p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
        cycle: status ? Number(marker(status, 'cycle') ?? 0) : null, cycleLimit: CYCLE_LIMIT,
        ciFails: status ? Number(marker(status, 'ci_fails') ?? 0) : 0,
        reviews, crewAddressed: crew && crew !== '-' ? crew.slice(0, 7) : null,
      };
    }
  }

  // PRs merged this week, and how long each was open.
  const merged = JSON.parse(await run(GH, ['pr', 'list', '--repo', REPO, '--state', 'merged', '--search', `merged:>=${weekStart.toISOString().slice(0, 19)}Z`,
    '--json', 'number,title,url,createdAt,mergedAt', '--limit', '100']));
  const hours = merged.map((m) => (new Date(m.mergedAt) - new Date(m.createdAt)) / HOUR).sort((a, b) => a - b);
  const median = hours.length ? hours[Math.floor(hours.length / 2)] : null;

  const pick = (i) => ({ number: i.number, title: i.title, url: i.url, closedAt: i.closedAt, size: i.size, epic: i.parent?.title ?? null });
  state.board = {
    at: Date.now(),
    task, pr, sprint,
    demo: demo ? { number: demo.number, title: demo.title, url: demo.url, status: demo.status } : null,
    counts,
    backlog: { total: backlog.length, blocked: backlog.filter((i) => i.blocked).length },
    week: {
      start: weekStart.getTime(), done: doneWeek.map(pick), prevDone: donePrev.length, weekly,
      merged: merged.length, medianPrHours: median,
    },
  };
}

// --- source: the orchestrator log -> the loop's heartbeat and recent moves -----

const LOG_FILE = process.env.BC_ORCHESTRATOR_LOG ?? path.join(STATE_DIR, 'orchestrator.log');
function readLoop() {
  let text = '';
  let size = 0;
  try {
    const fd = fs.openSync(LOG_FILE, 'r');
    size = fs.fstatSync(fd).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch (e) { throw new Error(`orchestrator log: ${e.message}`); }
  // A tick is its reason line followed by "<stamp> tick -> exit <n>"; the
  // stderr lines between them are diagnostics.
  const lines = text.split('\n');
  const ticks = [];
  let pending = [];
  let startedAt = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ) tick -> exit (\d+)$/.exec(line);
    if (m) {
      const reason = [...pending].reverse().find((l) => /^[a-z][a-z-]+ \S/.test(l) && !l.startsWith('orchestrator:')) ?? pending.at(-1) ?? '';
      ticks.push({ t: Date.parse(m[1]), exit: Number(m[2]), reason });
      pending = [];
      continue;
    }
    const s = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ) run-orchestrator: /.exec(line);
    if (s) { startedAt = Date.parse(s[1]); pending = []; continue; }
    if (line) pending.push(line);
  }
  // Collapse repeats of the same sleep into one row with a count.
  const events = [];
  for (const t of ticks) {
    const prev = events.at(-1);
    if (prev && prev.reason === t.reason && prev.exit === t.exit) { prev.count++; prev.t = t.t; }
    else events.push({ ...t, first: t.t, count: 1 });
  }
  const last = ticks.at(-1) ?? null;
  state.loop = {
    at: Date.now(), last, startedAt, intervalS: LOOP_INTERVAL_S,
    alive: !!last && Date.now() - last.t < (LOOP_INTERVAL_S * 2 + 600) * 1000,
    events: events.slice(-40).reverse(),
    actedToday: ticks.filter((t) => t.exit === 0 && t.t >= new Date().setHours(0, 0, 0, 0)).length,
  };
}

// --- source: transcripts -> spend per role per hour -----------------------------
// team-usage.mjs's rules, cut down to what the graph needs: role from the
// session's `agent-setting` (or its "bc-<role> #n" title), calls de-duplicated
// by message id, cost at API list prices (a weight that makes an Opus call and
// a Sonnet call comparable, not a bill). Keep PRICES in step with that file.

const PROJECTS = path.join(HOME, '.claude', 'projects');
const PRICES = [
  [/^claude-fable-5-1/, 10, 50, 0.25, 12.5, 20],
  [/^claude-(fable|mythos)-5/, 10, 50, 1, 12.5, 20],
  [/^claude-opus-(5|4-[678])/, 5, 25, 0.5, 6.25, 10],
  [/^claude-sonnet-5/, 2, 10, 0.2, 2.5, 4],
  [/^claude-sonnet-4-6/, 3, 15, 0.3, 3.75, 6],
  [/^claude-haiku-4-5/, 1, 5, 0.1, 1.25, 2],
];
const costOf = (model, i, o, cr, cw5, cw1) => {
  const p = PRICES.find(([re]) => re.test(model));
  return p ? (i * p[1] + o * p[2] + cr * p[3] + cw5 * p[4] + cw1 * p[5]) / 1e6 : 0;
};
const transcriptCache = new Map(); // file -> { size, mtime, meta, calls: [[t, cost, tokens]] }
function parseTranscript(file, since) {
  const meta = { agent: null, title: null };
  const byId = new Map();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { meta, calls: [] }; }
  for (const line of text.split('\n')) {
    if (line.length < 30) continue;
    if (line.startsWith('{"type":"agent-setting"') || line.startsWith('{"type":"custom-title"')) {
      try {
        const o = JSON.parse(line);
        if (o.type === 'agent-setting' && o.agentSetting) meta.agent = String(o.agentSetting);
        if (o.type === 'custom-title' && o.customTitle) meta.title = String(o.customTitle);
      } catch { /* skip */ }
      continue;
    }
    if (line.startsWith('{"type":"') || !line.includes('"type":"assistant"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const m = o.message, u = m?.usage;
    if (o.type !== 'assistant' || !u || !m.model || m.model.startsWith('<')) continue;
    const t = Date.parse(o.timestamp);
    if (!(t >= since)) continue;
    const cc = u.cache_creation;
    const cw5 = cc ? (cc.ephemeral_5m_input_tokens | 0) : (u.cache_creation_input_tokens | 0);
    const cw1 = cc ? (cc.ephemeral_1h_input_tokens | 0) : 0;
    const i = u.input_tokens | 0, out = u.output_tokens | 0, cr = u.cache_read_input_tokens | 0;
    byId.set(m.id || o.uuid, [t, costOf(m.model, i, out, cr, cw5, cw1), i + out + cr + cw5 + cw1]);
  }
  return { meta, calls: [...byId.values()] };
}
function roleOf(meta) {
  const m = /^bc-([a-z]+) #/i.exec(meta.title ?? '');
  const role = (meta.agent || (m ? m[1] : '') || 'human').toLowerCase();
  return ROLES.includes(role) ? role : 'human';
}
async function readSpend() {
  const weekStart = weekStartOf().getTime();
  const since = weekStart - 7 * DAY; // last week too, for the comparison
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS).filter((d) => d.includes('BrowserCity')); } catch { throw new Error(`no transcripts under ${PROJECTS}`); }
  const seen = new Set();
  const hourly = new Map(); // hourStart -> {role: cost}
  const week = {}, prev = {}, tokens = {};
  for (const d of dirs) {
    const dir = path.join(PROJECTS, d);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const main = path.join(dir, e.name);
      const files = [main];
      try {
        const sub = path.join(dir, e.name.slice(0, -6), 'subagents');
        for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(path.join(sub, f));
      } catch { /* no subagents */ }
      let role = null;
      for (const f of files) {
        let st;
        try { st = fs.statSync(f); } catch { continue; }
        seen.add(f);
        let rec = transcriptCache.get(f);
        if (st.mtimeMs < since) { // untouched since before the window: nothing in it counts
          if (f === main) role = 'skip';
          continue;
        }
        if (!rec || rec.size !== st.size || rec.mtime !== st.mtimeMs) {
          rec = { size: st.size, mtime: st.mtimeMs, ...parseTranscript(f, since) };
          transcriptCache.set(f, rec);
          await new Promise((r) => setImmediate(r)); // keep serving while a big backlog parses
        }
        if (f === main) role = roleOf(rec.meta);
        if (role === 'skip' || role === null) continue;
        for (const [t, cost, tok] of rec.calls) {
          if (t >= weekStart) {
            week[role] = (week[role] ?? 0) + cost;
            tokens[role] = (tokens[role] ?? 0) + tok;
            const h = Math.floor(t / HOUR) * HOUR;
            const b = hourly.get(h) ?? {};
            b[role] = (b[role] ?? 0) + cost;
            hourly.set(h, b);
          } else prev[role] = (prev[role] ?? 0) + cost;
        }
      }
    }
  }
  for (const f of transcriptCache.keys()) if (!seen.has(f)) transcriptCache.delete(f);
  state.spend = {
    at: Date.now(), weekStart, week, prev, tokens,
    hourly: [...hourly.entries()].sort((a, b) => a[0] - b[0]).map(([t, byRole]) => ({ t, ...byRole })),
  };
}

// --- scheduling ----------------------------------------------------------------

const SOURCES = [
  { name: 'sessions', every: 4e3, fn: readSessions },
  { name: 'loop', every: 5e3, fn: readLoop },
  { name: 'board', every: 60e3, fn: readBoard },
  { name: 'budget', every: 180e3, fn: readBudget },
  { name: 'spend', every: 60e3, fn: readSpend },
];
function schedule(src) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await src.fn(); delete state.errors[src.name]; }
    catch (e) { state.errors[src.name] = { message: e.message, at: Date.now() }; console.error(`[${src.name}] ${e.message}`); }
    finally { busy = false; }
  };
  tick();
  setInterval(tick, src.every);
}

// --- http ----------------------------------------------------------------------

const TILESET = path.join(REPO_ROOT, 'ModernTileset', 'moderninteriors-win');
const CHAR_DIR = path.join(TILESET, '2_Characters', 'Character_Generator', '0_Premade_Characters', '16x16');
// The six premade characters the README's art is drawn with.
const CHARACTER = { scotty: 12, crew: 4, tim: 14, derek: 8, quentin: 7, artie: 9 };
const STATIC = {
  '/': [path.join(HERE, 'index.html'), 'text/html; charset=utf-8'],
  '/index.html': [path.join(HERE, 'index.html'), 'text/html; charset=utf-8'],
  '/manifest.webmanifest': [path.join(HERE, 'manifest.webmanifest'), 'application/manifest+json'],
  '/art/emotes.png': [path.join(TILESET, '4_User_Interface_Elements', 'UI_thinking_emotes_animation_16x16.png'), 'image/png'],
  ...Object.fromEntries(Object.entries(CHARACTER).map(([r, n]) =>
    [`/art/${r}.png`, [path.join(CHAR_DIR, `Premade_Character_${String(n).padStart(2, '0')}.png`), 'image/png']])),
};

function snapshot() {
  const cut = Date.now() - 8 * DAY;
  return {
    now: Date.now(), startedAt: state.startedAt,
    sessions: state.sessions, budget: state.budget,
    budgetHistory: state.budgetHistory.filter((p) => p.t >= cut),
    board: state.board, loop: state.loop, spend: state.spend, errors: state.errors,
    caps: { session: SESSION_CAP, weekly: WEEKLY_CAP },
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(snapshot()));
    return;
  }
  const hit = STATIC[url.pathname];
  if (!hit) { res.writeHead(404); res.end('not found'); return; }
  fs.readFile(hit[0], (err, buf) => {
    if (err) { res.writeHead(500); res.end(String(err.message)); return; }
    res.writeHead(200, { 'content-type': hit[1], 'cache-control': hit[1].startsWith('image') ? 'max-age=86400' : 'no-cache' });
    res.end(buf);
  });
});

loadHistory();
for (const s of SOURCES) schedule(s);
server.listen(PORT, HOST, () => {
  const addrs = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log(`team-dashboard: http://localhost:${PORT}/`);
  for (const a of addrs) console.log(`               http://${a}:${PORT}/`);
});
