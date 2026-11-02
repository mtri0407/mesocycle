import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseErrors, applyPhases, phaseProgress, validatePhases, replacePhases, plusDays } from '../public/core/phases.js';
import { rollover, checkTemplate, closeWeek } from '../public/core/setup.js';
import { sampleWeek } from '../public/core/sample.js';
import { handlers } from '../public/core/handlers.js';
import { checkPlan } from '../public/core/invariants.js';
import { replan } from '../public/core/planner.js';

const TODAY = '2026-11-03'; // a Tuesday
const week = () => sampleWeek({ date: TODAY, weekday: 2, lang: 'en' });
const withPhases = (t, phases, goal = 0) => ({ ...t, goals: t.goals.map((g, i) => (i === goal ? { ...g, phases } : g)) });
const phase = (over) => ({ id: 'p1', title: 'Foundations', start: '2026-11-02', end: '2026-11-29', weeklyMin: 1200, expect: 'Band 5.5 in a mock test', ...over });

test('phases are checked like everything else a person edits', () => {
  const t = week();
  const role = t.roles.find((r) => r.id === t.goals[0].roleId);
  assert.deepEqual(phaseErrors(withPhases(t, [phase()])), []);
  const bad = withPhases(t, [phase({ title: '' }), phase({ id: 'p2', start: '2026-11-20', end: '2026-11-10' }), phase({ id: 'p3', weeklyMin: role.floorMin - 60 })]);
  const errors = phaseErrors(bad);
  assert.ok(errors.some((e) => /needs a name/.test(e)));
  assert.ok(errors.some((e) => /end after it starts/.test(e)));
  assert.ok(errors.some((e) => /weekly minimum/.test(e)));
  assert.ok(phaseErrors(withPhases(t, [phase(), phase({ id: 'p2', start: '2026-11-20', end: '2026-12-10' })])).some((e) => /overlap/.test(e)));
  assert.ok(checkTemplate(bad).length >= 3, 'hand edits are refused with the same reasons');
  assert.ok(phaseErrors(withPhases(t, [phase({ title: '' })]), 'vi')[0].includes('giai đoạn'));
});

test('a phase that begins sets its hours once; a later change by the person stays', () => {
  const t = withPhases(week(), [phase({ start: '2026-11-09', end: '2026-12-06', weeklyMin: 1500 })]);
  const roleId = t.goals[0].roleId;
  const target = (x) => x.roles.find((r) => r.id === roleId).targetMin;
  assert.equal(target(applyPhases(t, '2026-11-02')), target(t), 'not yet');
  const started = applyPhases(t, '2026-11-09');
  assert.equal(target(started), 1500);
  assert.equal(started.goals[0].phases[0].applied, '2026-11-09');
  const changed = { ...started, roles: started.roles.map((r) => (r.id === roleId ? { ...r, targetMin: 900 } : r)) };
  assert.equal(target(applyPhases(changed, '2026-11-16')), 900);
});

test('hours are never set under the weekly minimum', () => {
  const t = week();
  const role = t.roles.find((r) => r.id === t.goals[0].roleId);
  const out = applyPhases(withPhases(t, [{ ...phase(), weeklyMin: 0 }]), '2026-11-02');
  assert.equal(out.roles.find((r) => r.id === role.id).targetMin, role.floorMin);
});

test('a new week starts the phase, closes the old week, and every promise still holds', () => {
  const t = { ...withPhases(week(), [phase({ start: '2026-11-09', end: '2026-12-06', weeklyMin: 1500 })]), weekStart: '2026-11-02' };
  const out = rollover(t, null, { date: '2026-11-09', weekday: 1, now: 480 });
  assert.equal(out.template.weekStart, '2026-11-09');
  assert.equal(out.template.roles.find((r) => r.id === t.goals[0].roleId).targetMin, 1500);
  assert.ok(out.review, 'the old week was closed');
  assert.deepEqual(checkPlan(out.state, replan(out.state)), []);
});

test('an approved next week wins over a phase that starts the same week', () => {
  const t = { ...withPhases(week(), [phase({ start: '2026-11-09', end: '2026-12-06', weeklyMin: 1500 })]), weekStart: '2026-11-02' };
  const roleId = t.goals[0].roleId;
  const pending = { roles: t.roles.map((r) => ({ id: r.id, targetMin: r.id === roleId ? 1320 : r.targetMin })), tasks: [] };
  const out = rollover({ ...t, pending }, null, { date: '2026-11-09', weekday: 1, now: 480 });
  assert.equal(out.template.roles.find((r) => r.id === roleId).targetMin, 1320);
});

test('progress counts the weeks a phase covers, and asks how it went once it ends', () => {
  let t = withPhases(week(), [phase({ start: '2026-10-12', end: '2026-11-01' }), phase({ id: 'p2', start: '2026-11-02', end: '2026-11-29' })]);
  const roleId = t.goals[0].roleId;
  t = { ...t, history: [{ weekStart: '2026-10-12', roles: [{ id: roleId, doneMin: 600 }] }, { weekStart: '2026-10-19', roles: [{ id: roleId, doneMin: 900 }] }, { weekStart: '2026-10-26', roles: [{ id: roleId, doneMin: 300 }] }], weekStart: '2026-11-02', done: { [roleId]: 240 } };
  const [first, second] = phaseProgress(t, t.goals[0], TODAY);
  assert.equal(first.stage, 'ended');
  assert.equal(first.doneMin, 1800);
  assert.equal(first.perWeekMin, 600);
  assert.equal(first.needsRetro, true);
  assert.equal(second.stage, 'now');
  assert.equal(second.weekNo, 1);
  assert.equal(second.weeks, 4);
  assert.equal(second.doneMin, 240);
  const done = withPhases(t, [{ ...t.goals[0].phases[0], retro: { verdict: 'reached', at: TODAY } }, t.goals[0].phases[1]]);
  assert.equal(phaseProgress(done, done.goals[0], TODAY)[0].needsRetro, false);
});

test("the model's phases are checked: they follow each other from today, by the deadline, within the week", () => {
  const t = week();
  const goal = { ...t.goals[0], deadline: '2026-12-31' };
  const role = t.roles.find((r) => r.id === goal.roleId);
  const ctx = { goal, role, today: TODAY, capacityMin: 3000 };
  const good = { phases: [
    { title: 'Base', start: TODAY, end: '2026-11-23', weeklyHours: role.floorMin / 60 + 2, expect: 'All units reviewed' },
    { title: 'Practice', start: '2026-11-24', end: '2026-12-21', weeklyHours: role.floorMin / 60 + 4, expect: 'Two past papers above 80%' },
  ] };
  const ok = validatePhases(good, ctx);
  assert.equal(ok.errors, undefined);
  assert.equal(ok.phases.length, 2);
  assert.equal(ok.phases[1].weeklyMin % 15, 0);
  const gap = validatePhases({ phases: [good.phases[0], { ...good.phases[1], start: '2026-11-30' }] }, ctx);
  assert.ok(gap.errors.some((e) => /day after phase 1/.test(e)));
  const late = validatePhases({ phases: [good.phases[0], { ...good.phases[1], end: '2027-01-20' }] }, ctx);
  assert.ok(late.errors.some((e) => /deadline/.test(e)));
  const low = validatePhases({ phases: [{ ...good.phases[0], weeklyHours: 0 }] }, ctx);
  assert.ok(low.errors.some((e) => /weekly minimum/.test(e)));
  const high = validatePhases({ phases: [{ ...good.phases[0], weeklyHours: 90 }] }, ctx);
  assert.ok(high.errors.some((e) => /what a week can hold/.test(e)));
  assert.ok(validatePhases({ phases: [{ ...good.phases[0], start: '2026-11-04' }] }, ctx).errors.some((e) => /start today/.test(e)));
  assert.ok(validatePhases(null, ctx).errors.length);
});

test('replacing phases keeps the ones that already ended', () => {
  const goal = { id: 'g', phases: [phase({ id: 'old', start: '2026-09-01', end: '2026-10-31', retro: { verdict: 'partly' } }), phase({ id: 'cur' })] };
  const out = replacePhases(goal, [phase({ id: 'new', start: TODAY })], TODAY);
  assert.deepEqual(out.phases.map((p) => p.id), ['old', 'new']);
});

test('saving a phase that covers this week changes today at once', () => {
  const t = week();
  const s = handlers['/api/sample']({ date: TODAY, weekday: 2, lang: 'en' });
  const roleId = t.goals[0].roleId;
  const out = handlers['/api/edit']({ template: withPhases(s.template, [phase({ weeklyMin: 2400 })]), state: s.state, weekday: 2, lang: 'en' });
  assert.equal(out.ok, true);
  assert.equal(out.template.roles.find((r) => r.id === roleId).targetMin, 2400);
  assert.equal(out.template.goals[0].phases[0].applied, '2026-11-02');
});

test('closing a week keeps phases and their marks', () => {
  const t = { ...withPhases(week(), [phase({ applied: '2026-11-02' })]), weekStart: '2026-11-02' };
  assert.equal(closeWeek(t, '2026-11-09').goals[0].phases[0].applied, '2026-11-02');
});

test('focus that stops early shortens what is left, without moving the clock', () => {
  const s = handlers['/api/sample']({ date: TODAY, weekday: 2, lang: 'en' }).state;
  const item = s.queue.find((q) => q.status === 'todo');
  const out = handlers['/api/progress']({ state: s, id: item.id, minutes: 25 });
  const after = out.state.queue.find((q) => q.id === item.id);
  assert.equal(after.spent, 25);
  assert.equal(after.minutes, Math.max(15, item.minutes - 25));
  assert.equal(out.state.now, s.now);
  assert.equal(handlers['/api/progress']({ state: s, id: 'nope', minutes: 25 }).state, s);
});

test('plusDays crosses months', () => {
  assert.equal(plusDays('2026-11-30', 1), '2026-12-01');
});
