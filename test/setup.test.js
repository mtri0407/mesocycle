import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWeek, buildDay, forecastWeek } from '../src/setup.js';
import { replan } from '../src/planner.js';
import { checkPlan } from '../src/invariants.js';

const week = (over = {}) => ({
  roles: [{ name: 'Study', priority: 1, weeklyHours: 20, floorHours: 12 }, { name: 'Family', priority: 2, weeklyHours: 2, floorHours: 2 }],
  fixed: [{ title: 'Calculus', days: [2], start: '06:45', end: '10:10' }],
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
