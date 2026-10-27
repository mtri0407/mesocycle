import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toMin, toHHMM, freeWindows, replan, applyEvent, debtByRole, learnPace, adjustEstimate, deadlineRisk,
} from '../src/planner.js';
import { checkPlan } from '../src/invariants.js';

const settings = { wake: toMin('07:00'), sleep: toMin('23:00'), fillRatio: 1, bufferMin: 15 };
const item = (id, minutes, rank = 1, roleId = 'study') => ({ id, minutes, rank, roleId, status: 'todo' });
const day = (over = {}) => ({ now: toMin('07:00'), settings, roles: [], week: {}, fixed: [], queue: [], ...over });
const at = (plan, id) => toHHMM(plan.placed.find((p) => p.id === id).start);

test('free time skips fixed events and stops at sleep', () => {
  const w = freeWindows(toMin('08:00'), [{ id: 'c', start: toMin('09:00'), end: toMin('11:00') }], settings);
  assert.deepEqual(w.map(([a, b]) => [toHHMM(a), toHHMM(b)]), [['08:00', '09:00'], ['11:00', '23:00']]);
});

test('flexible work keeps its order and slides when the day starts late', () => {
  const s = day({ queue: [item('a', 90), item('b', 60)] });
  assert.equal(at(replan(s), 'b'), '08:45');
  const late = applyEvent(s, { type: 'late', minutes: 40 });
  const plan = replan(late);
  assert.equal(at(plan, 'a'), '07:40');
  assert.equal(at(plan, 'b'), '09:25');
  assert.equal(plan.needsUser, false);
});

test('work never lands on a class, it flows around it', () => {
  const s = day({ fixed: [{ id: 'class', start: toMin('08:00'), end: toMin('10:00') }], queue: [item('a', 90)] });
  assert.equal(at(replan(s), 'a'), '10:00');
});

test('only fillRatio of free time is planned', () => {
  const s = day({ now: toMin('21:00'), settings: { ...settings, fillRatio: 0.6 }, queue: [item('a', 60), item('b', 60)] });
  const plan = replan(s);
  assert.equal(plan.budgetMin, 72);
  assert.deepEqual(plan.cuts, ['b']);
});

test('overflow cuts extra blocks first, then Block 3, never Block 1 to save a lower one', () => {
  const s = day({
    now: toMin('20:00'),
    settings: { ...settings, bufferMin: 0 },
    queue: [item('b1', 90, 1), item('b3', 60, 3), item('x', 60, 'extra')],
  });
  // 180 free minutes: Block 1 and Block 3 fit, the extra block is cut.
  assert.deepEqual(replan(s).cuts, ['x']);
  // 120 free minutes: only Block 1 fits.
  const plan = replan({ ...s, now: toMin('21:00') });
  assert.deepEqual(plan.cuts.sort(), ['b3', 'x']);
  assert.equal(at(plan, 'b1'), '21:00');
  assert.equal(plan.needsUser, true);
});

test('the planner proposes cuts, it never applies them by itself', () => {
  const s = day({ now: toMin('22:00'), queue: [item('a', 120)] });
  const plan = replan(s);
  assert.deepEqual(plan.cuts, ['a']);
  assert.equal(s.queue[0].status, 'todo');
});

test('a floor is protected before rank, and breaking it is reported', () => {
  const roles = [{ id: 'study', priority: 1 }, { id: 'people', priority: 4, floorMin: 240 }];
  const week = { people: { done: 180, futureBudget: 0 } };
  const s = day({
    now: toMin('21:00'),
    settings: { ...settings, bufferMin: 0 },
    roles,
    week,
    queue: [item('study', 120, 1, 'study'), item('call-home', 60, 'extra', 'people')],
  });
  const plan = replan(s);
  assert.deepEqual(plan.cuts, ['study']);
  assert.equal(at(plan, 'call-home'), '21:00');

  const tight = replan({ ...s, now: toMin('22:30') });
  assert.deepEqual(tight.floorBreaches, ['people']);
});

test('overrun pushes the rest of the day, skipped work becomes debt', () => {
  let s = day({ queue: [item('a', 60), item('b', 60), item('c', 30, 'extra', 'clubs')] });
  s = applyEvent(s, { type: 'work', id: 'a', minutes: 100, finished: true });
  assert.equal(at(replan(s), 'b'), '08:40');
  s = applyEvent(s, { type: 'skip', id: 'c' });
  assert.deepEqual(debtByRole(s.queue), { clubs: 30 });
  assert.deepEqual(s.actuals, [{ roleId: 'study', est: 60, actual: 100 }]);
});

test('partial work keeps the remainder in the queue', () => {
  let s = day({ queue: [item('a', 90)] });
  s = applyEvent(s, { type: 'work', id: 'a', minutes: 50, finished: false });
  assert.equal(s.queue[0].minutes, 40);
  assert.equal(s.queue[0].status, 'todo');
});

test('an interruption becomes a fixed event and work moves around it', () => {
  let s = day({ queue: [item('a', 60)] });
  s = applyEvent(s, { type: 'interrupt', start: toMin('07:00'), minutes: 60, title: 'Meeting', newId: 'm' });
  assert.equal(at(replan(s), 'a'), '08:00');
});

test('events never change the state they were given', () => {
  const s = day({ queue: [item('a', 60)] });
  applyEvent(s, { type: 'skip', id: 'a' });
  assert.equal(s.queue[0].status, 'todo');
});

test('pace is learned from real time, needs 3 samples and is clamped', () => {
  const a = (est, actual) => ({ roleId: 'study', est, actual });
  assert.deepEqual(learnPace([a(60, 75), a(60, 80)]), {});
  assert.deepEqual(learnPace([a(60, 75), a(60, 80), a(90, 110)]), { study: 1.25 });
  assert.deepEqual(learnPace([a(10, 100), a(10, 100), a(10, 100)]), { study: 2 });
  const adj = adjustEstimate(90, 1.25);
  assert.equal(adj.minutes, 115);
  assert.match(adj.why, /25% longer/);
});

test('deadline risk compares work left with usable time left', () => {
  const r = deadlineRisk({ needMin: 600, days: [{ freeMin: 300 }, { freeMin: 400 }], fillRatio: 0.6 });
  assert.deepEqual(r, { ok: false, capacityMin: 420, shortMin: 180 });
});

test('a messy day keeps every promise', () => {
  let s = day({
    settings: { ...settings, fillRatio: 0.6 },
    fixed: [{ id: 'class', start: toMin('09:00'), end: toMin('11:00') }],
    queue: [item('a', 90), item('b', 90, 2), item('c', 60, 3), item('d', 45, 'extra')],
  });
  const fixed = structuredClone(s.fixed);
  for (const ev of [
    { type: 'late', minutes: 50 },
    { type: 'interrupt', start: toMin('14:00'), minutes: 90, newId: 'meeting' },
    { type: 'work', id: 'a', minutes: 130, finished: true, start: toMin('11:00') },
    { type: 'skip', id: 'd' },
  ]) {
    s = applyEvent(s, ev);
    assert.deepEqual(checkPlan(s, replan(s), fixed), []);
  }
});
