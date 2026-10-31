import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWeek, buildDay, forecastWeek, rebaseDay, rollover, goalPace, validateNext, adoptNext, checkTemplate } from '../src/setup.js';
import { replan } from '../src/planner.js';
import { checkPlan } from '../src/invariants.js';

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
const day3 = (t) => buildDay(t, { date: '2026-11-03', weekday: 2, now: 11 * 60 });

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
