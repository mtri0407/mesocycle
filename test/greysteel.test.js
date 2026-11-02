import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGreysteel, fromGreysteel } from '../public/core/greysteel.js';
import { checkTemplate, rollover } from '../public/core/setup.js';
import { checkPlan } from '../public/core/invariants.js';
import { replan } from '../public/core/planner.js';

const TODAY = '2026-11-03';
// The shape Greysteel Tasks writes, made up for the test.
const T = (id, weekday, start, end, type, goalId, label) => ({ id, weekday, start, end, type, goalId, label, count: 1 });
const FILE = {
  schemaVersion: 2,
  goals: [
    { id: 'goal-gpa', title: 'GPA', rank: 1, timeBudgetMinPerWeek: 18 * 60 },
    { id: 'goal-gym', title: 'Gym', rank: 2, timeBudgetMinPerWeek: 6 * 60 },
    { id: 'goal-old', title: 'Deleted', rank: 3, deletedAt: '2026-10-01' },
    { id: 'g-ielts', title: 'IELTS 7.0', area: 'study', unit: 'band', startValue: 5, targetValue: 7, targetDate: '2027-06-01', rank: null, timeBudgetMinPerWeek: null,
      phases: [
        { id: 'ph1', name: 'Nền tảng', startDate: '2026-09-01', endDate: '2026-10-31', expectedValue: 5.5, actualValue: 6, weeklyTarget: 6, weeklyUnit: 'giờ' },
        { id: 'ph2', name: 'Tăng tốc', startDate: '2026-10-25', endDate: '2026-12-31', expectedValue: 6.5, actualValue: '', weeklyTarget: 8, weeklyUnit: 'giờ' },
      ] },
  ],
  blockTemplates: [
    T('a', 1, '09:00', '12:00', 'protected', 'goal-gpa', 'Học sâu'),
    T('b', 1, '16:30', '18:00', 'flexible', 'goal-gym', 'Gym'),
    T('c', 2, '06:00', '10:10', 'fixed', 'goal-gpa', 'Lớp Giải tích 1'),
    T('d', 4, '06:00', '10:10', 'fixed', 'goal-gpa', 'Lớp Giải tích 1'),
    T('e', 3, '23:00', '01:00', 'flexible', 'goal-gpa', 'Overnight'),
    T('f', 5, '12:00', '13:00', 'flexible', '', 'Ăn trưa'),
    { ...T('g', 6, '08:00', '09:00', 'flexible', 'goal-gpa', 'Gone'), deletedAt: '2026-10-02' },
  ],
  tasks: [
    { id: 't1', title: 'Nộp bài Giải tích', status: 'todo', dueDate: '2026-11-07', quadrant: 1, estBlocks: 2, tags: 'GPA' },
    { id: 't2', title: 'Việc quá hạn', status: 'doing', dueDate: '2026-10-20', quadrant: 2 },
    { id: 't3', title: 'Xong rồi', status: 'done' },
  ],
  settings: { sleepRules: [{ wakeWeekdays: [2, 3, 4], start: '22:00', end: '05:00' }, { wakeWeekdays: [0, 1, 5, 6], start: '23:00', end: '07:00' }] },
  focusSessions: [
    { id: 's1', goalId: 'goal-gpa', startedAt: '2026-11-02T09:00:00+07:00', endedAt: '2026-11-02T09:50:00+07:00', minutes: 50 },
    { id: 's2', goalId: 'goal-gpa', startedAt: '2026-11-02T10:00:00+07:00', minutes: 0 },
    { id: 's3', goalId: 'goal-gym', startedAt: 'bad', minutes: 30 },
  ],
  people: [{ id: 'p1', name: 'Mẹ', date: '1970-05-02' }],
  notes: [{ id: 'n1', content: 'mật khẩu wifi' }],
};

test('a Greysteel Tasks file is recognised, anything else is not', () => {
  assert.equal(isGreysteel(FILE), true);
  assert.equal(isGreysteel({ tasks: [] }), false);
  assert.equal(isGreysteel([1, 2]), false);
  assert.equal(isGreysteel(null), false);
});

test('roles, fixed classes, blocks, tasks, goals with phases and focus come across', () => {
  const { template: t, summary } = fromGreysteel(FILE, { today: TODAY });
  assert.deepEqual(t.roles.map((r) => r.name), ['GPA', 'Gym', 'IELTS 7.0']);
  assert.equal(t.roles[0].floorMin, 180, 'protected blocks are the weekly minimum');
  assert.equal(t.roles[0].targetMin, 1080);
  assert.equal(t.roles[1].kind, 'life');
  assert.deepEqual(t.fixed.map((f) => [f.title, f.days]), [['Lớp Giải tích 1', [2, 4]]]);
  assert.ok(t.tasks.some((x) => x.title === 'Học sâu (1/2)' && x.rank === 1));
  assert.ok(!t.tasks.some((x) => /Overnight|Gone|Ăn trưa/.test(x.title)), 'overnight, deleted and unassigned blocks are left out');
  const due = t.tasks.find((x) => x.title === 'Nộp bài Giải tích');
  assert.deepEqual([due.deadline, due.minutes, due.rank, due.roleId], ['2026-11-07', 100, 1, 'r1']);
  assert.equal(t.tasks.find((x) => x.title === 'Việc quá hạn').debt, true);
  assert.ok(!t.tasks.some((x) => x.title === 'Xong rồi'));
  assert.deepEqual([t.wake, t.sleep], ['07:00', '23:00']);
  const ielts = t.goals.find((g) => g.title === 'IELTS 7.0');
  assert.equal(ielts.measure, '5 → 7 band');
  assert.equal(ielts.phases[0].retro.verdict, 'reached');
  assert.equal(ielts.phases[1].start, '2026-11-01', 'an overlapping phase is trimmed');
  assert.equal(ielts.phases[1].weeklyMin, 480);
  assert.equal(t.log.length, 1);
  assert.equal(t.log[0].minutes, 50);
  assert.equal(summary.focusMin, 50);
  assert.equal(summary.skipped, 2);
});

test('people and notes never leave the file', () => {
  const text = JSON.stringify(fromGreysteel(FILE, { today: TODAY }));
  assert.ok(!text.includes('mật khẩu'));
  assert.ok(!text.includes('Mẹ'));
});

test('the imported week passes every check and plans a day that keeps every promise', () => {
  const { template } = fromGreysteel(FILE, { today: TODAY });
  assert.deepEqual(checkTemplate(template), []);
  const out = rollover(template, null, { date: TODAY, weekday: 2, now: 600 });
  assert.deepEqual(checkPlan(out.state, replan(out.state)), []);
  assert.ok(out.state.fixed.some((f) => f.title === 'Lớp Giải tích 1'));
});

test('an empty or odd file still gives a week that works', () => {
  const { template } = fromGreysteel({ goals: [], blockTemplates: [{ junk: true }] }, { today: TODAY });
  assert.equal(template.roles.length, 1);
  assert.deepEqual(checkTemplate(template), []);
});
