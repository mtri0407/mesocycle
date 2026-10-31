// "Set up my week in 60 seconds": the user describes their week (voice or
// text, optionally a timetable photo). Muse Spark answers with one build_week
// tool call; code checks it and builds today's plan from it.
import { replan, toMin } from './planner.js';

export const SETUP_PROMPT = `You turn a person's description of their week into a plan template
by calling build_week exactly once.

- roles: the areas of their life they mention (study, work, training,
  family and friends...). priority 1 = most important, in the order they
  give. weeklyHours = what they want; floorHours = the minimum they never
  want to drop below (default about half of weeklyHours; for family and
  friends at least 2 hours if they mention them).
- fixed: things with a set time each week (classes, shifts, practice).
  days use 0=Sunday ... 6=Saturday. Read times from the photo if there is one.
- tasks: flexible work as blocks of 30 to 120 minutes, enough blocks to
  cover each role's weeklyHours. rank 1 for the most important block of a
  role, then 2, 3, or "extra" for nice-to-have. Deadlines as YYYY-MM-DD.
- wake and sleep as HH:MM. Default 07:00 and 23:00.
Names in the user's language. Do not invent commitments they did not mention.`;

export const BUILD_WEEK = {
  type: 'function',
  function: {
    name: 'build_week',
    description: 'Create the weekly plan template.',
    parameters: {
      type: 'object',
      properties: {
        roles: { type: 'array', items: { type: 'object', properties: {
          name: { type: 'string' }, priority: { type: 'integer' }, weeklyHours: { type: 'number' }, floorHours: { type: 'number' },
        }, required: ['name', 'priority', 'weeklyHours', 'floorHours'] } },
        fixed: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string' }, days: { type: 'array', items: { type: 'integer' } }, start: { type: 'string' }, end: { type: 'string' },
        }, required: ['title', 'days', 'start', 'end'] } },
        tasks: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string' }, role: { type: 'string', description: 'Role name' }, minutes: { type: 'integer' },
          rank: { type: 'string', enum: ['1', '2', '3', 'extra'] }, deadline: { type: 'string' },
        }, required: ['title', 'role', 'minutes', 'rank'] } },
        wake: { type: 'string' }, sleep: { type: 'string' },
      },
      required: ['roles', 'fixed', 'tasks', 'wake', 'sleep'],
    },
  },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// House style: no em or en dashes in names the user reads.
const DASHES = new RegExp('\\s*[' + String.fromCharCode(0x2013, 0x2014) + ']\\s*', 'g');
const clean = (s, fallback) => String(s || fallback).replace(DASHES, ': ').trim();

// Checks the model's build_week arguments. Returns { template } or { errors }.
export function validateWeek(a) {
  const errors = [];
  if (!a || typeof a !== 'object') return { errors: ['Arguments were not valid JSON.'] };
  const roles = Array.isArray(a.roles) ? a.roles : [];
  if (!roles.length || roles.length > 8) errors.push('roles: give 1 to 8 roles.');
  const byName = new Map();
  roles.forEach((r, i) => {
    if (typeof r?.name !== 'string' || !r.name.trim()) errors.push(`roles[${i}].name is required.`);
    if (!(r?.weeklyHours >= 0 && r.weeklyHours <= 80)) errors.push(`roles[${i}].weeklyHours must be 0 to 80.`);
    if (!(r?.floorHours >= 0 && r.floorHours <= (r?.weeklyHours ?? 0))) errors.push(`roles[${i}].floorHours must be 0 to weeklyHours.`);
    if (r?.name) byName.set(r.name.trim().toLowerCase(), `r${i + 1}`);
  });
  const fixed = Array.isArray(a.fixed) ? a.fixed : [];
  fixed.forEach((f, i) => {
    if (!HHMM.test(f?.start || '') || !HHMM.test(f?.end || '') || toMin(f.end) <= toMin(f.start)) errors.push(`fixed[${i}]: start and end must be HH:MM with end after start.`);
    if (!Array.isArray(f?.days) || !f.days.length || !f.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) errors.push(`fixed[${i}].days must be integers 0 to 6.`);
  });
  const tasks = Array.isArray(a.tasks) ? a.tasks : [];
  if (tasks.length > 60) errors.push('tasks: at most 60.');
  tasks.forEach((t, i) => {
    if (!byName.has(String(t?.role || '').trim().toLowerCase())) errors.push(`tasks[${i}].role "${t?.role}" is not one of the roles.`);
    if (!(Number.isInteger(t?.minutes) && t.minutes >= 15 && t.minutes <= 180)) errors.push(`tasks[${i}].minutes must be an integer from 15 to 180.`);
    if (!['1', '2', '3', 'extra'].includes(String(t?.rank))) errors.push(`tasks[${i}].rank must be 1, 2, 3 or extra.`);
    if (t?.deadline && !DATE.test(t.deadline)) errors.push(`tasks[${i}].deadline must be YYYY-MM-DD.`);
  });
  if (!HHMM.test(a.wake || '') || !HHMM.test(a.sleep || '') || toMin(a.sleep) <= toMin(a.wake)) errors.push('wake and sleep must be HH:MM with sleep after wake (same day).');
  if (errors.length) return { errors };

  return {
    template: {
      roles: roles.map((r, i) => ({ id: `r${i + 1}`, name: clean(r.name), priority: r.priority || i + 1, targetMin: Math.round(r.weeklyHours * 60), floorMin: Math.round(r.floorHours * 60) })),
      fixed: fixed.map((f, i) => ({ id: `f${i + 1}`, title: clean(f.title, 'Fixed'), days: f.days, start: f.start, end: f.end })),
      tasks: tasks.map((t, i) => ({
        id: `t${i + 1}`, title: clean(t.title, 'Task'), roleId: byName.get(t.role.trim().toLowerCase()),
        minutes: t.minutes, rank: t.rank === 'extra' ? 'extra' : Number(t.rank), deadline: t.deadline || null, status: 'todo',
      })),
      wake: a.wake,
      sleep: a.sleep,
    },
  };
}

// Today's plan from the template: today's fixed events, then open tasks
// (earliest deadline, most important role, best rank first) added while they
// still fit. The rest stays in the backlog for later days.
export function buildDay(template, { date, weekday, now }) {
  const prio = (id) => template.roles.find((r) => r.id === id)?.priority ?? 99;
  const rank = { 1: 1, 2: 2, 3: 3, extra: 4 };
  const daysLeft = (7 - weekday) % 7; // days after today until the week ends on Sunday
  const state = {
    date,
    now,
    settings: { wake: toMin(template.wake), sleep: toMin(template.sleep), fillRatio: 0.6, bufferMin: 15 },
    roles: template.roles,
    // Floors are weekly: the days left can still cover their share.
    week: Object.fromEntries(template.roles.map((r) => [r.id, {
      done: template.done?.[r.id] || 0, futureBudget: 0, laterMin: Math.round((r.floorMin * daysLeft) / 7),
    }])),
    fixed: template.fixed.filter((f) => f.days.includes(weekday)).map((f) => ({ id: f.id, title: f.title, start: toMin(f.start), end: toMin(f.end) })),
    queue: [],
    deadlines: [],
    actuals: template.actuals || [],
  };
  const open = template.tasks.filter((t) => t.status === 'todo')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || prio(a.roleId) - prio(b.roleId) || rank[a.rank] - rank[b.rank]);
  for (const t of open) {
    const trial = { ...state, queue: [...state.queue, { id: t.id, title: t.title, roleId: t.roleId, minutes: t.minutes, rank: t.rank, status: 'todo' }] };
    if (!replan(trial).needsUser) state.queue = trial.queue;
  }
  return state;
}

// A forecast for the rest of the week: where open work (including today's
// debt) would land if every later day started fresh. It is only a preview;
// each morning the real day is planned again from what actually happened.
export function forecastWeek(template, { weekday, exclude = [] }) {
  const days = [];
  let tasks = template.tasks.map((t) => ({ ...t, status: exclude.includes(t.id) ? 'done' : t.status }));
  for (let d = weekday + 1; d <= 7; d++) {
    const wd = d % 7;
    const day = buildDay({ ...template, tasks }, { date: '', weekday: wd, now: toMin(template.wake) });
    const placed = replan(day).placed;
    const ids = new Set(placed.map((p) => p.id));
    days.push({
      weekday: wd,
      items: day.queue.filter((q) => ids.has(q.id)).map((q) => ({ id: q.id, title: q.title, roleId: q.roleId, minutes: q.minutes })),
      fixed: day.fixed.map((f) => f.title),
    });
    tasks = tasks.map((t) => (ids.has(t.id) ? { ...t, status: 'done' } : t));
  }
  return { days, left: tasks.filter((t) => t.status === 'todo').map((t) => ({ id: t.id, title: t.title, roleId: t.roleId, minutes: t.minutes })) };
}
