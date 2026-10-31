// Stress test for whole weeks: the code around the day planner. Random people
// with random weeks live through broken days, hand edits, the agent's additions,
// new weeks and impossible deadlines, and after every step the promises are checked.
//   node scripts/simulate-weeks.mjs [weeks] [seed]
// Same seed, same weeks: a failure can always be replayed exactly.
import { replan, toHHMM, sleepMinutes, applyEvent } from '../public/core/planner.js';
import { checkPlan } from '../public/core/invariants.js';
import { buildDay, rollover, rebaseDay, pullNext, addDays, forecastWeek, checkTemplate, weekReview } from '../public/core/setup.js';
import { runTool, floorBroken } from '../public/core/tools.js';
import { runWeekTool } from '../public/core/week-tools.js';
import { deadlineRadar } from '../public/core/radar.js';
import { tradeoffCandidates } from '../public/core/tradeoff.js';
import { planDiff } from '../public/core/diff.js';

const WEEKS = Number(process.argv[2] || 10000);
const SEED = Number(process.argv[3] || 20261101);

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
const r = rng(SEED);
const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(r() * xs.length)];
const hhmm = (m) => toHHMM(m);

let uid = 0;
function newTemplate(date) {
  const roles = Array.from({ length: int(2, 6) }, (_, i) => {
    const target = int(1, 12) * 120;
    return { id: `r${i}`, name: `Role ${i}`, priority: i + 1, targetMin: target, floorMin: r() < 0.7 ? int(0, target / 30) * 30 : 0, kind: r() < 0.5 ? 'life' : 'commitment' };
  });
  const wake = int(5 * 4 + 1, 9 * 4) * 15;
  const sleep = int(21 * 4, 25 * 4 + 2) * 15; // up to 01:30, after midnight
  const fixed = Array.from({ length: int(0, 7) }, (_, i) => {
    const start = int(Math.ceil(wake / 15), 20 * 4) * 15;
    return { id: `f${i}`, title: `Class ${i}`, days: [...new Set(Array.from({ length: int(1, 3) }, () => int(0, 6)))], start: hhmm(start), end: hhmm(Math.min(start + pick([60, 90, 180]), 23 * 60)) };
  }).filter((f) => f.end > f.start);
  const tasks = Array.from({ length: int(3, 25) }, () => ({
    id: `t${++uid}`, title: `Task ${uid}`, roleId: pick(roles).id, minutes: pick([30, 45, 60, 90, 120, 180]), rank: pick([1, 2, 3, 'extra']),
    deadline: r() < 0.3 ? addDays(date, int(0, 20)) : null, status: 'todo',
  }));
  return { roles, fixed, tasks, goals: [], wake: hhmm(wake), sleep: hhmm(sleep % 1440), weekStart: null };
}

const counts = { days: 0, edits: 0, added: 0, cuts: 0, candidates: 0, weeksClosed: 0, deadlinesAtRisk: 0, deadlinesSafe: 0 };

function fail(why, ctx) {
  console.error(`\nBROKEN PROMISE (seed ${SEED}): ${why}`);
  console.error(JSON.stringify(ctx).slice(0, 800));
  process.exit(1);
}

function check(state, template, where) {
  const plan = replan(state);
  const errors = checkPlan(state, plan);
  if (errors.length) fail(`${where}: ${errors.join(', ')}`, { where });
  if (state.settings.sleep !== sleepMinutes(template.wake, template.sleep)) fail(`${where}: sleep moved`, { where });
  const ids = state.queue.map((q) => q.id);
  if (new Set(ids).size !== ids.length) fail(`${where}: an item is in the queue twice`, ids);
  return plan;
}

function checkRadar(template, state, date, weekday) {
  const before = template.tasks.filter((t) => t.status === 'todo' && t.deadline).length;
  const rows = deadlineRadar(template, state, { date, weekday });
  if (rows.length !== before) fail('radar lost a deadline', { before, after: rows.length });
  for (const row of rows) {
    if (row.ok !== (row.shortMin === 0)) fail('radar disagrees with itself', row);
    if (row.ok && (!row.finishDate || row.finishDate > row.date)) fail('radar called a late finish safe', row);
    counts[row.ok ? 'deadlinesSafe' : 'deadlinesAtRisk']++;
  }
}

function checkCandidates(state) {
  if (!replan(state).needsUser) return;
  for (const c of tradeoffCandidates(state)) {
    counts.candidates++;
    const after = applyEvent(state, { type: 'cut', ids: c.ids });
    if (replan(after).needsUser) fail('a candidate does not fit', c);
    if (floorBroken(state, c.ids).length) fail('a candidate breaks a floor', c);
  }
}

const t0 = performance.now();
for (let run = 0; run < WEEKS / 4; run++) {
  // Each person lives about four weeks, so new weeks close with real history.
  let date = addDays('2026-01-05', int(0, 300));
  let weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  let template = newTemplate(date);
  if (checkTemplate(template).length) continue;
  let prev = null;
  for (let d = 0; d < 28; d++) {
    const debtBefore = template.tasks.filter((t) => t.status === 'todo' && t.debt).map((t) => t.id);
    const wake = 7 * 60;
    const out = rollover(template, prev, { date, weekday, now: wake + int(0, 8 * 60) });
    if (out.review) counts.weeksClosed++;
    const reviewed = weekReview(out.template);
    if (reviewed.roles.length !== template.roles.length) fail('a role vanished in a review', {});
    template = out.template;
    for (const id of debtBefore) {
      if (!template.tasks.some((t) => t.id === id && t.status === 'todo')) fail('debt was lost', { id });
    }
    let state = out.state;
    counts.days++;
    if (check(state, template, 'new day').needsUser) fail('a new day starts with more than fits', { date });
    checkRadar(template, state, date, weekday);

    for (let n = int(0, 6); n > 0; n--) {
      const before = state;
      const x = r();
      const open = state.queue.filter((q) => q.status === 'todo');
      if (x < 0.3 && open.length) {
        const q = pick(open);
        const res = runTool(state, 'update_item', { id: q.id, status: 'done', minutes: int(10, 200) });
        state = res.state;
        const task = template.tasks.find((t) => t.id === q.id);
        if (task) { template = { ...template, tasks: template.tasks.map((t) => (t.id === q.id ? { ...t, status: 'done' } : t)), done: { ...template.done, [q.roleId]: (template.done?.[q.roleId] || 0) + q.minutes }, actuals: state.actuals }; }
      } else if (x < 0.45 && open.length) {
        state = runTool(state, 'update_item', { id: pick(open).id, status: 'skipped' }).state;
      } else if (x < 0.6) {
        state = runTool(state, 'add_fixed', { title: 'Meeting', start: hhmm(int(wake, 20 * 60)), minutes: pick([30, 60, 120]) }).state;
      } else if (x < 0.75) {
        const res = runWeekTool(template, pick(['add_task', 'add_event', 'add_goal']), { title: 'New', role: pick(template.roles).id, minutes: 60, rank: '2', deadline: addDays(date, int(0, 9)), start: '18:00', date: addDays(date, int(1, 9)), measure: 'x' }, { today: date });
        if (res.ok) { template = res.template; counts.added++; state = rebaseDay(template, state, { weekday }); }
      } else if (x < 0.9) {
        // A hand edit: change an estimate, drop a task, or move a class.
        const tasks = template.tasks.filter((t) => t.status === 'todo');
        if (tasks.length) {
          const t = pick(tasks);
          const drop = r() < 0.4;
          template = { ...template, tasks: drop ? template.tasks.filter((k) => k.id !== t.id) : template.tasks.map((k) => (k.id === t.id ? { ...k, minutes: pick([30, 60, 90]) } : k)) };
          state = rebaseDay(template, state, { weekday });
          counts.edits++;
        }
      } else if (x < 0.95) {
        state = pullNext(template, state);
      } else {
        state = { ...state, now: Math.min(state.now + int(10, 180), state.settings.sleep) };
      }
      const plan = check(state, template, 'after a change');
      planDiff(before, state);
      checkCandidates(state);
      if (plan.needsUser && r() < 0.5) {
        counts.cuts++;
        state = applyEvent(state, { type: 'cut', ids: plan.cuts });
        check(state, template, 'after an approved cut');
      }
    }
    forecastWeek(template, { weekday, date });
    prev = state;
    date = addDays(date, 1);
    weekday = (weekday + 1) % 7;
  }
}

const ms = Math.round(performance.now() - t0);
const f = (n) => n.toLocaleString('en-US');
console.log(`Simulated ${f(counts.days)} days of whole weeks in ${ms} ms (seed ${SEED}).`);
console.log(`Weeks closed ${f(counts.weeksClosed)}, hand edits ${f(counts.edits)}, agent additions ${f(counts.added)}, approved cuts ${f(counts.cuts)}, cut candidates checked ${f(counts.candidates)}.`);
console.log(`Deadlines checked: ${f(counts.deadlinesSafe)} safe, ${f(counts.deadlinesAtRisk)} at risk.`);
console.log('Broken promises: 0');
