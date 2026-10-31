// Tools that reach past today. Like tools.js, each one checks its arguments
// and answers with a reason when it refuses. They only add: nothing here can
// remove work, move sleep or lower a floor.
import { checkTemplate } from './setup.js';
import { toMin, toHHMM } from './planner.js';

export const WEEK_TOOL_DEFS = [
  {
    name: 'add_task',
    description: 'Add flexible work for another day or with a deadline. It joins the backlog and is planned when there is room, earliest deadline first.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        role: { type: 'string', description: 'Role id from get_state' },
        minutes: { type: 'integer' },
        rank: { type: 'string', enum: ['1', '2', '3', 'extra'] },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title', 'role', 'minutes', 'rank'],
    },
  },
  {
    name: 'add_event',
    description: 'Add something with a set time that is not today: give date for one time, or days for every week (0=Sunday ... 6=Saturday).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'HH:MM, 24h' },
        minutes: { type: 'integer' },
        date: { type: 'string', description: 'YYYY-MM-DD, for one time' },
        days: { type: 'array', items: { type: 'integer' }, description: 'For every week' },
      },
      required: ['title', 'start', 'minutes'],
    },
  },
  {
    name: 'add_goal',
    description: 'Add a longer-term goal served by one role.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        role: { type: 'string', description: 'Role id from get_state' },
        measure: { type: 'string' },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title', 'role'],
    },
  },
];

export const WEEK_TOOLS = WEEK_TOOL_DEFS.map((t) => ({ type: 'function', function: t }));
export const WEEK_TOOL_NAMES = new Set(WEEK_TOOL_DEFS.map((t) => t.name));

export const ACCEPT_TOOL = {
  type: 'function',
  function: {
    name: 'accept_proposal',
    description: 'The user clearly chose an option of the pending proposal. Only then, apply it.',
    parameters: { type: 'object', properties: { option: { type: 'integer', description: '1 or 2' } }, required: ['option'] },
  },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const reject = (error) => ({ ok: false, error });
const clean = (s) => String(s || '').trim().slice(0, 120);

function nextId(t, prefix) {
  let n = (t.tasks.length + t.fixed.length + (t.goals || []).length) + 1;
  const used = (id) => t.tasks.some((x) => x.id === id) || t.fixed.some((x) => x.id === id) || (t.goals || []).some((x) => x.id === id);
  while (used(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const dayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

// Returns { ok, template, result } or { ok: false, error }.
export function runWeekTool(t, name, a, { today }) {
  if (!a || typeof a !== 'object') return reject('Arguments were not valid JSON.');
  const hasRole = (id) => t.roles.some((r) => r.id === id);
  const roles = t.roles.map((r) => r.id).join(', ');
  let next;
  if (name === 'add_task') {
    if (!clean(a.title)) return reject('title is required.');
    if (!hasRole(a.role)) return reject(`Unknown role "${a.role}". Roles: ${roles}.`);
    if (!(Number.isInteger(a.minutes) && a.minutes >= 15 && a.minutes <= 180)) return reject('minutes must be an integer from 15 to 180. Split longer work into several tasks.');
    if (!['1', '2', '3', 'extra'].includes(String(a.rank))) return reject('rank must be 1, 2, 3 or extra.');
    if (a.deadline && (!DATE.test(a.deadline) || a.deadline < today)) return reject(`deadline must be YYYY-MM-DD, today (${today}) or later.`);
    const task = { id: nextId(t, 'a'), title: clean(a.title), roleId: a.role, minutes: a.minutes, rank: String(a.rank) === 'extra' ? 'extra' : Number(a.rank), deadline: a.deadline || null, status: 'todo', oneOff: true };
    next = { ...t, tasks: [...t.tasks, task] };
  } else if (name === 'add_event') {
    if (!clean(a.title)) return reject('title is required.');
    if (!HHMM.test(a.start || '')) return reject('start must be HH:MM (24h).');
    if (!(Number.isInteger(a.minutes) && a.minutes >= 5 && a.minutes <= 600)) return reject('minutes must be an integer from 5 to 600.');
    const end = toMin(a.start) + a.minutes;
    if (end >= 1440) return reject('The event must end the same day.');
    const once = !!a.date;
    if (once === (Array.isArray(a.days) && a.days.length > 0)) return reject('Give either date (one time) or days (every week).');
    if (once && (!DATE.test(a.date) || a.date <= today)) return reject(`date must be after today (${today}). For today use add_fixed.`);
    if (!once && !a.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return reject('days must be integers 0 to 6.');
    const ev = { id: nextId(t, 'a'), title: clean(a.title), days: once ? [dayOf(a.date)] : a.days, start: a.start, end: toHHMM(end), ...(once ? { on: a.date } : {}) };
    next = { ...t, fixed: [...t.fixed, ev] };
  } else if (name === 'add_goal') {
    if (!clean(a.title)) return reject('title is required.');
    if (!hasRole(a.role)) return reject(`Unknown role "${a.role}". Roles: ${roles}.`);
    if (a.deadline && !DATE.test(a.deadline)) return reject('deadline must be YYYY-MM-DD.');
    const goal = { id: nextId(t, 'a'), title: clean(a.title), roleId: a.role, measure: clean(a.measure), deadline: a.deadline || null };
    next = { ...t, goals: [...(t.goals || []), goal] };
  } else return reject(`Unknown tool "${name}".`);
  const errors = checkTemplate(next);
  if (errors.length) return reject(errors.join(' '));
  return { ok: true, template: next, result: { added: name } };
}
