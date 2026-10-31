import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWeek, buildDay, forecastWeek, rebaseDay, rollover, goalPace, checkinBrief, pullNext, validateNext, adoptNext, checkTemplate } from '../public/core/setup.js';
import { replan } from '../public/core/planner.js';
import { runWeekTool } from '../public/core/week-tools.js';
import { deadlineRadar } from '../public/core/radar.js';
import { planDiff } from '../public/core/diff.js';
import { runAgent } from '../src/agent.js';
import { sampleWeek } from '../public/core/sample.js';
import { checkPlan } from '../public/core/invariants.js';

const week = (over = {}) => ({
  roles: [{ name: 'Study', priority: 1, weeklyHours: 20, floorHours: 12 }, { name: 'Family', priority: 2, weeklyHours: 2, floorHours: 2 }],
  fixed: [{ title: 'Calculus', days: [2], start: '08:00', end: '10:00' }],
  tasks: [
    ...Array.from({ length: 10 }, (_, i) => ({ title: `Study ${i + 1}`, role: 'Study', minutes: 120, rank: '1' })),
    { title: 'Call home', role: 'family', minutes: 30, rank: 'extra' },
  ],
  wake: '07:00',
  sleep: '23:00',
  ...over,
});

test('a valid week becomes a template, role names match case-insensitively', () => {
  const { template, errors } = validateWeek(week());
  assert.equal(errors, undefined);
  assert.equal(template.roles[0].floorMin, 720);
  assert.equal(template.tasks.at(-1).roleId, 'r2');
});

test('every bad field is reported, so the model can fix all of it at once', () => {
  const { errors } = validateWeek(week({ wake: '7am', tasks: [{ title: 'x', role: 'Gaming', minutes: 5, rank: '9' }] }));
  assert.equal(errors.length, 4);
});

test('dashes in model-made names are replaced (house style)', () => {
  const dash = String.fromCharCode(0x2013);
  const { template } = validateWeek(week({ tasks: [{ title: `Calculus ${dash} midterm`, role: 'Study', minutes: 60, rank: '1' }] }));
  assert.equal(template.tasks[0].title, 'Calculus: midterm');
});

test("today's plan has today's classes, fits, and keeps every promise", () => {
  const { template } = validateWeek(week());
  const state = buildDay(template, { date: '2026-11-03', weekday: 2, now: 7 * 60 });
  assert.deepEqual(state.fixed.map((f) => f.title), ['Calculus']);
  assert.equal(replan(state).needsUser, false);
  assert.deepEqual(checkPlan(state, replan(state)), []);
});

test('the week forecast places the rest of the work on later days, each day keeping the rules', () => {
  const { template } = validateWeek(week());
  const f = forecastWeek(template, { weekday: 5 });
  assert.deepEqual(f.days.map((d) => d.weekday), [6, 0]);
  const placed = f.days.flatMap((d) => d.items.map((i) => i.id));
  assert.equal(new Set(placed).size, placed.length);
  assert.equal(placed.length + f.left.length, template.tasks.length);
});

const tpl = (over = {}) => ({ ...validateWeek(week()).template, weekStart: '2026-11-02', ...over });
const day3 = (t) => buildDay(t, { date: '2026-11-03', weekday: 2, now: 11 * 60, spread: false });

test('goals must point at a real role, and are optional', () => {
  assert.deepEqual(validateWeek(week()).template.goals, []);
  const { template } = validateWeek(week({ goals: [{ title: 'GPA 3.9', role: 'study', measure: 'GPA', deadline: '2027-01-15' }] }));
  assert.equal(template.goals[0].roleId, 'r1');
  assert.equal(validateWeek(week({ goals: [{ title: 'x', role: 'Gaming' }] })).errors.length, 1);
});

test('editing mid-day keeps finished work, debt and what the agent added', () => {
  const t = tpl();
  const day = day3(t);
  const [a, b, c] = day.queue;
  const state = {
    ...day,
    fixed: [...day.fixed, { id: 'fix-2', title: 'Meeting', start: 19 * 60, end: 20 * 60 }],
    queue: [{ ...a, status: 'done' }, { ...b, status: 'skipped' }, ...day.queue.slice(2), { id: 'q-9', title: 'From agent', roleId: 'r1', minutes: 30, rank: 2, status: 'todo' }],
  };
  const edited = { ...t, tasks: t.tasks.map((x) => (x.id === c.id ? { ...x, title: 'Renamed' } : x)) };
  const out = rebaseDay(edited, state, { weekday: 2 });
  assert.equal(out.queue.find((q) => q.id === a.id).status, 'done');
  assert.equal(out.queue.find((q) => q.id === b.id).status, 'skipped');
  assert.equal(out.queue.find((q) => q.id === c.id).title, 'Renamed');
  assert.ok(out.queue.some((q) => q.id === 'q-9'));
  assert.ok(out.fixed.some((f) => f.id === 'fix-2'));
  assert.deepEqual(checkPlan(out, replan(out)), []);
});

test('editing: a deleted task leaves today, a changed estimate wins, extra time survives otherwise', () => {
  const t = tpl();
  const day = day3(t);
  const [a, b, c] = day.queue;
  const state = { ...day, queue: day.queue.map((q) => (q.id === b.id ? { ...q, minutes: q.minutes + 15 } : q)) };
  const edited = { ...t, tasks: t.tasks.filter((x) => x.id !== a.id).map((x) => (x.id === c.id ? { ...x, minutes: 45 } : x)) };
  const out = rebaseDay(edited, state, { weekday: 2 });
  assert.ok(!out.queue.some((q) => q.id === a.id));
  assert.equal(out.queue.find((q) => q.id === b.id).minutes, b.minutes + 15);
  assert.equal(out.queue.find((q) => q.id === c.id).minutes, 45);
});

test('a new day keeps unfinished agent work as debt', () => {
  const t = tpl();
  const day = day3(t);
  const state = { ...day, queue: [...day.queue, { id: 'q-9', title: 'From agent', roleId: 'r1', minutes: 30, rank: 2, status: 'todo' }] };
  const out = rollover(t, state, { date: '2026-11-04', weekday: 3, now: 7 * 60 });
  assert.equal(out.review, null);
  assert.ok(out.template.tasks.some((x) => x.title === 'From agent' && x.debt));
});

test('a new week: review stored, hours reset, debt stays, blocks reopen', () => {
  const t = tpl({ done: { r1: 300 } });
  t.tasks[0].status = 'done';
  t.tasks[1].debt = true;
  const out = rollover(t, null, { date: '2026-11-09', weekday: 1, now: 7 * 60 });
  assert.equal(out.review.roles[0].doneMin, 300);
  assert.equal(out.review.roles[0].floorKept, false);
  assert.equal(out.review.debtMin, 120);
  assert.deepEqual(out.template.done, {});
  assert.equal(out.template.weekStart, '2026-11-09');
  assert.equal(out.template.tasks[0].status, 'todo');
  assert.equal(out.template.tasks[1].debt, true);
  assert.equal(out.template.history.length, 1);
  assert.deepEqual(checkPlan(out.state, replan(out.state)), []);
});

test('a template from before this feature starts its week without a false review', () => {
  const t = tpl();
  delete t.weekStart;
  const out = rollover(t, null, { date: '2026-11-04', weekday: 3, now: 7 * 60 });
  assert.equal(out.review, null);
  assert.equal(out.template.weekStart, '2026-11-02');
});

test('goal pace: quiet on Monday, warns when far behind, fine when on pace', () => {
  const t = tpl({ goals: [{ id: 'g1', title: 'GPA', roleId: 'r1', deadline: '2026-11-08' }], done: { r1: 60 } });
  assert.equal(goalPace(t, { weekday: 1 })[0].behind, false);
  const late = goalPace(t, { weekday: 5, date: '2026-11-06' })[0];
  assert.equal(late.behind, true);
  assert.equal(late.daysLeft, 2);
  assert.equal(goalPace({ ...t, done: { r1: 600 } }, { weekday: 5 })[0].behind, false);
});

test('next week: roles must all be there, not under the floor, within what the week can hold', () => {
  const t = tpl();
  const tasks = [{ title: 'New', role: 'Study', minutes: 60, rank: '1' }];
  const ok = validateNext(t, { roles: [{ name: 'Study', weeklyHours: 15, why: 'honest' }, { name: 'family', weeklyHours: 2, why: 'same' }], tasks });
  assert.equal(ok.errors, undefined);
  assert.equal(ok.next.roles[0].fromMin, 1200);
  assert.equal(ok.next.roles[0].targetMin, 900);
  const bad = (roles) => validateNext(t, { roles, tasks }).errors;
  assert.ok(bad([{ name: 'Study', weeklyHours: 15, why: '' }]).some((e) => e.includes('missing')));
  assert.ok(bad([{ name: 'Study', weeklyHours: 5, why: '' }, { name: 'Family', weeklyHours: 2, why: '' }]).some((e) => e.includes('floor')));
  assert.ok(bad([{ name: 'Study', weeklyHours: 79, why: '' }, { name: 'Family', weeklyHours: 2, why: '' }]).some((e) => e.includes('usable')));
  assert.ok(bad([{ name: 'Study', weeklyHours: 15, why: '' }, { name: 'Family', weeklyHours: 2, why: '' }, { name: 'Gaming', weeklyHours: 2, why: '' }]).some((e) => e.includes('Do not add')));
});

test('an approved next week brings debt along and changes neither floors nor sleep', () => {
  const t = tpl();
  t.tasks[1].debt = true;
  const next = { roles: [{ id: 'r1', targetMin: 900 }], tasks: [{ id: 'wx-1', title: 'New', roleId: 'r1', minutes: 60, rank: 1, status: 'todo' }] };
  const out = adoptNext(t, next);
  assert.equal(out.roles[0].targetMin, 900);
  assert.equal(out.roles[0].floorMin, t.roles[0].floorMin);
  assert.equal(out.sleep, t.sleep);
  assert.deepEqual(out.tasks.map((x) => x.id), [t.tasks[1].id, 'wx-1']);
});

test('a next week approved early waits for the new week', () => {
  const next = { roles: [{ id: 'r1', targetMin: 900 }], tasks: [{ id: 'wx-1', title: 'New', roleId: 'r1', minutes: 60, rank: 1, status: 'todo' }] };
  const out = rollover(tpl({ pending: next }), null, { date: '2026-11-09', weekday: 1, now: 7 * 60 });
  assert.equal(out.template.roles[0].targetMin, 900);
  assert.equal(out.template.pending, null);
  assert.deepEqual(out.template.tasks.map((x) => x.id), ['wx-1']);
});

test('hand edits are checked', () => {
  const t = tpl();
  assert.deepEqual(checkTemplate(t), []);
  assert.equal(checkTemplate({ ...t, roles: [{ ...t.roles[0], floorMin: 9999 }, t.roles[1]] }).length, 1);
  assert.equal(checkTemplate({ ...t, fixed: [{ title: 'x', days: [], start: '09:00', end: '08:00' }] }).length, 2);
  assert.ok(checkTemplate({ ...t, roles: [t.roles[1]] }).some((e) => e.includes('no longer exists')));
});

test('the check-in sees plan names and pace, nothing else', () => {
  const t = tpl({ goals: [{ id: 'g1', title: 'GPA', roleId: 'r1', deadline: null }], done: {}, email: 'a@b.c' });
  t.tasks[1].debt = true;
  const view = { queue: [{ title: 'Study 1', start: '11:00' }], fixed: [], doesNotFit: [] };
  const brief = JSON.parse(checkinBrief(t, view, { weekday: 5, date: '2026-11-06' }));
  assert.equal(brief.debt.length, 1);
  assert.equal(brief.goals[0].behind, true);
  assert.ok(!JSON.stringify(brief).includes('a@b.c'));
});

const add = (t, name, a) => runWeekTool(t, name, a, { today: '2026-11-03' });

test('the agent can add work with a deadline, and it is planned first', () => {
  const r = add(tpl(), 'add_task', { title: 'Report', role: 'r1', minutes: 120, rank: '1', deadline: '2026-11-05' });
  assert.equal(r.ok, true);
  const day = buildDay(r.template, { date: '2026-11-03', weekday: 2, now: 11 * 60 });
  assert.equal(day.queue[0].title, 'Report');
});

test('week tools refuse bad input with a reason', () => {
  assert.match(add(tpl(), 'add_task', { title: 'x', role: 'r9', minutes: 60, rank: '1' }).error, /Unknown role/);
  assert.match(add(tpl(), 'add_task', { title: 'x', role: 'r1', minutes: 60, rank: '1', deadline: '2026-11-01' }).error, /today/);
  assert.match(add(tpl(), 'add_event', { title: 'x', start: '09:00', minutes: 60 }).error, /either date/);
  assert.match(add(tpl(), 'add_event', { title: 'x', start: '09:00', minutes: 60, date: '2026-11-03' }).error, /add_fixed/);
});

test('a one-time event lands on its date only, and leaves with its week', () => {
  const { template } = add(tpl(), 'add_event', { title: 'Dentist', start: '09:00', minutes: 60, date: '2026-11-05' });
  const on = (date, weekday) => buildDay(template, { date, weekday, now: 7 * 60 }).fixed.map((f) => f.title);
  assert.ok(on('2026-11-05', 4).includes('Dentist'));
  assert.ok(!on('2026-11-12', 4).includes('Dentist'));
  const next = rollover(template, null, { date: '2026-11-09', weekday: 1, now: 7 * 60 });
  assert.ok(!next.template.fixed.some((f) => f.title === 'Dentist'));
});

test('a repeating event comes back every week', () => {
  const { template } = add(tpl(), 'add_event', { title: 'Club', start: '18:00', minutes: 60, days: [4] });
  assert.ok(buildDay(template, { date: '2026-11-12', weekday: 4, now: 7 * 60 }).fixed.some((f) => f.title === 'Club'));
});

const script = (...calls) => { let i = 0; return async () => { const c = calls[i++]; return c ? { text: '', toolCalls: [c], message: {} } : { text: 'ok', toolCalls: [], message: {} }; }; };

test('the agent adds to the week and today follows, on a real week only', async () => {
  const t = tpl();
  const state = day3(t);
  const call = { id: '1', name: 'add_task', args: { title: 'Report', role: 'r1', minutes: 60, rank: '1', deadline: '2026-11-03' } };
  const out = await runAgent({ state, userText: 'x', chatFn: script(call), template: t, weekday: 2 });
  assert.ok(out.template.tasks.some((x) => x.title === 'Report'));
  assert.ok(out.state.queue.some((q) => q.title === 'Report'));
  const demo = await runAgent({ state, userText: 'x', chatFn: script(call) });
  assert.equal(demo.template, undefined);
  assert.equal(demo.trace[0].ok, false);
});

test('a spoken choice applies the pending proposal; a wrong option changes nothing', async () => {
  const t = tpl();
  const state = day3(t);
  const id = state.queue[0].id;
  const pending = { options: [[id]] };
  const ok = await runAgent({ state, userText: 'option 1', chatFn: script({ id: '1', name: 'accept_proposal', args: { option: 1 } }), pending });
  assert.equal(ok.state.queue.find((q) => q.id === id).status, 'cut');
  const bad = await runAgent({ state, userText: 'option 2', chatFn: script({ id: '1', name: 'accept_proposal', args: { option: 2 } }), pending });
  assert.equal(bad.trace[0].ok, false);
  assert.equal(bad.state.queue.find((q) => q.id === id).status, 'todo');
});

test('work due today joins a full day, so the user is asked instead of it slipping', () => {
  const t = tpl();
  const day = day3(t);
  const { template } = add(t, 'add_task', { title: 'Due now', role: 'r1', minutes: 120, rank: '1', deadline: '2026-11-03' });
  const out = rebaseDay(template, { ...day, now: 18 * 60 }, { weekday: 2 });
  assert.ok(out.queue.some((q) => q.title === 'Due now'));
  assert.deepEqual(checkPlan(out, replan(out)), []);
});

for (const lang of ['en', 'vi']) {
  test(`the sample week is valid and keeps every promise (${lang})`, () => {
    for (let weekday = 0; weekday < 7; weekday++) {
      const date = `2026-11-${String(8 + weekday).padStart(2, '0')}`;
      const real = (new Date(`${date}T00:00:00Z`)).getUTCDay();
      const t = sampleWeek({ date, weekday: real, lang });
      assert.deepEqual(checkTemplate(t), []);
      const day = buildDay(t, { date, weekday: real, now: 9 * 60 });
      assert.deepEqual(checkPlan(day, replan(day)), []);
      assert.equal(t.sample, true);
      assert.ok(t.history.length >= 2);
    }
    const friday = sampleWeek({ date: '2026-11-13', weekday: 5, lang });
    assert.ok(goalPace(friday, { weekday: 5, date: '2026-11-13' }).some((g) => g.behind));
  });
}

test('bedtime after midnight is a longer day, not an error', () => {
  const { template, errors } = validateWeek(week({ sleep: '01:00' }));
  assert.equal(errors, undefined);
  const day = buildDay(template, { date: '2026-11-03', weekday: 2, now: 22 * 60 });
  assert.equal(day.settings.sleep, 25 * 60);
  const plan = replan(day);
  assert.deepEqual(checkPlan(day, plan), []);
  assert.equal(plan.freeMin, 180); // 22:00 to 01:00
  assert.deepEqual(checkTemplate(template), []);
  assert.ok(validateWeek(week({ sleep: '05:00' })).errors.length); // that is a morning, not a bedtime
  assert.ok(checkTemplate({ ...template, sleep: '06:00' }).length);
});

const minutesOn = (d) => d.items.reduce((s, i) => s + i.minutes, 0);

test('work spreads across the week instead of piling up at the start', () => {
  const t = tpl();
  const monday = buildDay(t, { date: '2026-11-02', weekday: 1, now: 7 * 60 });
  const planned = monday.queue.reduce((s, q) => s + q.minutes, 0);
  assert.ok(planned <= 3 * 60, `${planned} min on Monday`);
  assert.ok(planned >= 60);
  const f = forecastWeek(t, { weekday: 1, date: '2026-11-02', exclude: monday.queue.map((q) => q.id) });
  assert.ok(f.days.filter((d) => minutesOn(d) > 0).length >= 5, 'most days get work');
  assert.ok(minutesOn(f.days.at(-1)) > 0, 'Sunday is not empty');
});

test('the old way is one option away, and the 60% ceiling still holds', () => {
  const t = tpl();
  const packed = buildDay(t, { date: '2026-11-02', weekday: 1, now: 7 * 60, spread: false });
  const spread = buildDay(t, { date: '2026-11-02', weekday: 1, now: 7 * 60 });
  assert.ok(packed.queue.length > spread.queue.length);
  assert.deepEqual(checkPlan(spread, replan(spread)), []);
});

test('work due tomorrow joins today no matter the share', () => {
  const { template } = add(tpl(), 'add_task', { title: 'Due tomorrow', role: 'r2', minutes: 120, rank: '3', deadline: '2026-11-04' });
  const day = buildDay(template, { date: '2026-11-03', weekday: 2, now: 11 * 60 });
  assert.ok(day.queue.some((q) => q.title === 'Due tomorrow'));
});

test('finished early: one more block comes from the backlog', () => {
  const t = tpl();
  const day = buildDay(t, { date: '2026-11-03', weekday: 2, now: 11 * 60 });
  const before = day.queue.length;
  const more = pullNext(t, day);
  assert.equal(more.queue.length, before + 1);
  assert.equal(new Set(more.queue.map((q) => q.id)).size, more.queue.length);
});

test('estimates follow how long a role really takes, and say why', () => {
  const actuals = [{ roleId: 'r1', est: 120, actual: 150 }, { roleId: 'r1', est: 60, actual: 75 }, { roleId: 'r1', est: 90, actual: 110 }];
  const day = buildDay(tpl({ actuals }), { date: '2026-11-03', weekday: 2, now: 11 * 60, spread: false });
  const item = day.queue.find((q) => q.roleId === 'r1');
  assert.equal(item.base, 120);
  assert.equal(item.estimate, 120);
  assert.equal(item.minutes, 150);
  assert.equal(buildDay(tpl({ actuals: actuals.slice(0, 2) }), { date: '2026-11-03', weekday: 2, now: 11 * 60, spread: false }).queue[0].minutes, 120);
});

const radarFor = (t, now = 11 * 60) => deadlineRadar(t, buildDay(t, { date: '2026-11-03', weekday: 2, now }), { date: '2026-11-03', weekday: 2 });

test('radar: a deadline with room is safe, and says when it will finish', () => {
  const { template } = add(tpl(), 'add_task', { title: 'Report', role: 'r1', minutes: 120, rank: '1', deadline: '2026-11-06' });
  const [r] = radarFor(template);
  assert.equal(r.ok, true);
  assert.equal(r.shortMin, 0);
  assert.equal(r.finishDate, '2026-11-03');
});

test('radar: too much for the time left says exactly how much is missing', () => {
  let t = tpl();
  for (let i = 0; i < 6; i++) t = add(t, 'add_task', { title: `Part ${i}`, role: 'r1', minutes: 180, rank: '1', deadline: '2026-11-03' }).template;
  const rows = radarFor(t, 20 * 60);
  assert.ok(rows.some((r) => !r.ok));
  const budget = replan(buildDay(t, { date: '2026-11-03', weekday: 2, now: 20 * 60 })).budgetMin;
  assert.equal(rows.reduce((s, r) => s + r.shortMin, 0), 6 * 180 - budget);
});

test('radar: earliest deadline first, a day of classes counts, past deadlines are flagged', () => {
  const t0 = tpl({ fixed: [{ id: 'f1', title: 'All day', days: [3], start: '07:00', end: '23:00' }] });
  const { template } = add(t0, 'add_task', { title: 'Wednesday only', role: 'r1', minutes: 60, rank: '1', deadline: '2026-11-04' });
  const blocked = deadlineRadar(template, { ...buildDay(template, { date: '2026-11-03', weekday: 2, now: 23 * 60 }) }, { date: '2026-11-03', weekday: 2 });
  assert.equal(blocked[0].ok, false);
  assert.equal(blocked[0].shortMin, 60);
  const late = { ...tpl(), tasks: [{ id: 't1', title: 'Old', roleId: 'r1', minutes: 60, rank: 1, status: 'todo', deadline: '2026-10-01' }] };
  assert.equal(radarFor(late)[0].ok, false);
});

test('the agent reads the radar, so it cannot claim a deadline is safe when it is not', async () => {
  let seen = '';
  const t = tpl();
  const state = buildDay(t, { date: '2026-11-03', weekday: 2, now: 22 * 60 });
  const model = async (messages) => {
    seen = messages.at(-1).content;
    return messages.at(-1).role === 'tool' ? { text: 'done', toolCalls: [], message: {} } : { text: '', toolCalls: [{ id: '1', name: 'add_task', args: { title: 'Huge', role: 'r1', minutes: 180, rank: '1', deadline: '2026-11-03' } }], message: {} };
  };
  await runAgent({ state, userText: 'x', chatFn: model, template: t, weekday: 2 });
  const plan = JSON.parse(seen);
  assert.equal(plan.deadlines[0].title, 'Huge');
  assert.equal(plan.deadlines[0].ok, false);
  assert.ok(plan.deadlines[0].shortMin > 0);
});

test('the diff comes from the plans: moved, added, debt, new work for later', () => {
  const t = tpl();
  const before = day3(t);
  const late = { ...before, now: before.now + 30, fixed: [...before.fixed, { id: 'fix-9', title: 'Meeting', start: 12 * 60, end: 13 * 60 }], queue: before.queue.map((q, i) => (i === 1 ? { ...q, status: 'cut' } : q)) };
  const next = add(t, 'add_task', { title: 'Later', role: 'r1', minutes: 60, rank: '1', deadline: '2026-11-20' }).template;
  const d = planDiff(before, late, t, next);
  assert.deepEqual(d.fixedAdded.map((x) => x.title), ['Meeting']);
  assert.deepEqual(d.toDebt, [before.queue[1].title]);
  assert.ok(d.moved.length > 0);
  assert.deepEqual(d.laterTasks.map((x) => x.title), ['Later']);
  assert.deepEqual(planDiff(before, before).moved, []);
});

test('on Sunday the week is over: nothing is forecast past it', () => {
  assert.deepEqual(forecastWeek(tpl(), { weekday: 0 }).days, []);
});
