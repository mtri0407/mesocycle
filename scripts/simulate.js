// Stress test: live through many randomly broken days and check after every
// re-plan that no promise in src/invariants.js is broken.
//   node scripts/simulate.js [days] [seed]
// Same seed, same days: a failure can always be replayed exactly.
import { replan, applyEvent, toHHMM } from '../src/planner.js';
import { checkPlan } from '../src/invariants.js';

const DAYS = Number(process.argv[2] || 100000);
const SEED = Number(process.argv[3] || 20261027);

// Small seeded random generator (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLES = [
  { id: 'study', priority: 1, floorMin: 600 },
  { id: 'work', priority: 2, floorMin: 300 },
  { id: 'health', priority: 3, floorMin: 270 },
  { id: 'people', priority: 4, floorMin: 240 },
  { id: 'clubs', priority: 5 },
];

function makeDay(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const wake = int(6 * 4, 8 * 4) * 15;
  const sleep = int(22 * 4, 24 * 4 - 1) * 15;
  const fixed = [];
  for (let i = 0, n = int(0, 3); i < n; i++) {
    const start = int(wake / 15, sleep / 15 - 4) * 15;
    fixed.push({ id: `fix-${i}`, start, end: Math.min(sleep, start + pick([60, 90, 120, 240])) });
  }
  const queue = [];
  for (let i = 0, n = int(2, 9); i < n; i++) {
    queue.push({ id: `q-${i}`, roleId: pick(ROLES).id, minutes: pick([20, 30, 45, 60, 90, 120]), rank: pick([1, 2, 3, 'extra']), status: 'todo' });
  }
  const week = {};
  for (const role of ROLES) week[role.id] = { done: int(0, 400), futureBudget: int(0, 300), laterMin: int(0, 1) * int(0, 300) };
  return {
    now: wake + int(0, 180),
    settings: { wake, sleep, fillRatio: pick([0.5, 0.6, 0.7, 1]), bufferMin: pick([0, 10, 15, 20]) },
    roles: ROLES,
    week,
    fixed,
    queue,
  };
}

// One random thing that happens next, the way real days go wrong.
function nextEvent(r, state, plan, n) {
  const x = r();
  const next = [...plan.placed].sort((a, b) => a.start - b.start)[0];
  if (plan.cuts.length && x < 0.3) return { type: 'cut', ids: plan.cuts };
  if (next && x < 0.65) {
    const item = state.queue.find((i) => i.id === next.id);
    const want = Math.max(5, Math.round(item.minutes * (0.5 + r() * 1.5)));
    // Real time cannot run through a class or past sleep, so the work stops there.
    const wall = Math.min(state.settings.sleep, ...state.fixed.filter((f) => f.start >= next.start).map((f) => f.start));
    const minutes = Math.min(want, wall - next.start);
    return { type: 'work', id: next.id, start: next.start, minutes, finished: minutes === want && r() < 0.85 };
  }
  if (x < 0.75) return { type: 'late', minutes: Math.round(10 + r() * 110) };
  if (x < 0.85) return { type: 'interrupt', start: state.now + Math.round(r() * 240), minutes: 15 + Math.round(r() * 165), newId: `int-${n}` };
  if (next && x < 0.93) return { type: 'skip', id: next.id };
  return { type: 'add', item: { id: `new-${n}`, roleId: ROLES[Math.floor(r() * ROLES.length)].id, minutes: 30 + 15 * Math.floor(r() * 7), rank: 'extra' } };
}

const r = rng(SEED);
const t0 = performance.now();
let replans = 0;
let proposals = 0;
let floorWarnings = 0;
const counts = {};

for (let day = 0; day < DAYS; day++) {
  let state = makeDay(r);
  const originalFixed = structuredClone(state.fixed);
  const log = [];
  for (let n = 0; n < 40 && state.now < state.settings.sleep; n++) {
    const plan = replan(state);
    replans++;
    if (plan.needsUser) proposals++;
    if (plan.floorBreaches.length) floorWarnings++;
    const errors = checkPlan(state, plan, originalFixed);
    if (errors.length) {
      console.error(`\nBROKEN PROMISE on day ${day} (seed ${SEED}) after:`);
      for (const e of log) console.error('  ', JSON.stringify(e));
      console.error('now', toHHMM(state.now), 'errors:', errors);
      process.exit(1);
    }
    if (!plan.placed.length && !plan.cuts.length) break;
    const ev = nextEvent(r, state, plan, n);
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    log.push(ev);
    state = applyEvent(state, ev);
  }
}

const ms = Math.round(performance.now() - t0);
console.log(`Simulated ${DAYS.toLocaleString('en-US')} broken days, ${replans.toLocaleString('en-US')} re-plans in ${ms} ms (seed ${SEED}).`);
console.log('Events:', Object.entries(counts).map(([k, v]) => `${k} ${v.toLocaleString('en-US')}`).join(', '));
console.log(`Cut proposals asked: ${proposals.toLocaleString('en-US')}, floor warnings: ${floorWarnings.toLocaleString('en-US')}.`);
console.log('Broken promises: 0');
