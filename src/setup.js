// "Set up my week in 60 seconds": the user describes their week (voice or
// text, optionally a timetable photo). Muse Spark answers with one build_week
// tool call; code checks it and builds today's plan from it.
import { replan, toMin, freeWindows } from './planner.js';

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
- goals: the longer-term results they mention (a GPA, a revenue target, an
  exam, a lift). role = the role that serves it, measure = how they would
  know they got there, deadline as YYYY-MM-DD if they gave one. Leave goals
  empty if they mention none; never invent one.
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
        goals: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string' }, role: { type: 'string', description: 'Role name' }, measure: { type: 'string' }, deadline: { type: 'string' },
        }, required: ['title', 'role'] } },
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
  const goals = Array.isArray(a.goals) ? a.goals : [];
  if (goals.length > 12) errors.push('goals: at most 12.');
  goals.forEach((g, i) => {
    if (typeof g?.title !== 'string' || !g.title.trim()) errors.push(`goals[${i}].title is required.`);
    if (!byName.has(String(g?.role || '').trim().toLowerCase())) errors.push(`goals[${i}].role "${g?.role}" is not one of the roles.`);
    if (g?.deadline && !DATE.test(g.deadline)) errors.push(`goals[${i}].deadline must be YYYY-MM-DD.`);
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
      goals: goals.map((g, i) => ({ id: `g${i + 1}`, title: clean(g.title), roleId: byName.get(g.role.trim().toLowerCase()), measure: g.measure ? clean(g.measure) : '', deadline: g.deadline || null })),
      wake: a.wake,
      sleep: a.sleep,
    },
  };
}

// Today's plan from the template: today's fixed events, then open tasks
// (earliest deadline, most important role, best rank first) added while they
// still fit. The rest stays in the backlog for later days.
function openTasks(template) {
  const prio = (id) => template.roles.find((r) => r.id === id)?.priority ?? 99;
  const rank = { 1: 1, 2: 2, 3: 3, extra: 4 };
  return template.tasks.filter((t) => t.status === 'todo')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || prio(a.roleId) - prio(b.roleId) || rank[a.rank] - rank[b.rank]);
}

const toItem = (t) => ({ id: t.id, title: t.title, roleId: t.roleId, minutes: t.minutes, base: t.minutes, rank: t.rank, status: 'todo' });

// Adds tasks to the queue one by one while the day still fits without a cut.
function fill(state, tasks) {
  for (const t of tasks) {
    const trial = { ...state, queue: [...state.queue, toItem(t)] };
    if (!replan(trial).needsUser) state.queue = trial.queue;
  }
  return state;
}

export function buildDay(template, { date, weekday, now }) {
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
  return fill(state, openTasks(template));
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

const isAgentFixed = (f) => /^(fix|int)-/.test(String(f.id));

// The user edited the template in the middle of a day. Today keeps what
// already happened: finished work, debt, and whatever the agent added stay.
// Only what was edited changes. Nothing is cut here: if the day no longer
// fits, replan reports it and the user decides, as everywhere else.
export function rebaseDay(template, state, { weekday }) {
  const fresh = buildDay({ ...template, tasks: [] }, { date: state.date, weekday, now: state.now });
  const tasks = new Map(template.tasks.map((t) => [t.id, t]));
  const fromAgent = (q) => /^q-/.test(String(q.id));
  const queue = [];
  for (const q of state.queue) {
    const t = tasks.get(q.id);
    if (!t) {
      if (fromAgent(q) || q.status === 'done') queue.push(q);
      continue; // deleted by the user
    }
    if (q.status !== 'todo') { queue.push(q); continue; }
    // A changed estimate wins; an unchanged one keeps any "need more time".
    const changed = t.minutes !== (q.base ?? q.minutes);
    queue.push({ ...q, title: t.title, roleId: t.roleId, rank: t.rank, base: t.minutes, minutes: changed ? t.minutes : q.minutes });
  }
  const next = { ...fresh, fixed: [...fresh.fixed, ...state.fixed.filter(isAgentFixed)], queue, actuals: state.actuals || [] };
  return fill(next, openTasks(template).filter((t) => !queue.some((q) => q.id === t.id)));
}

// Monday of the week a date is in. Weeks run Monday to Sunday.
export function mondayOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Carries a finished day into the template: results of tool calls, and work
// the agent added that was not finished (it would vanish with the day).
export function absorbDay(template, state) {
  const t = { ...template, tasks: template.tasks.map((x) => ({ ...x })), actuals: state.actuals || template.actuals || [] };
  const byId = new Map(t.tasks.map((x) => [x.id, x]));
  for (const q of state.queue) {
    const task = byId.get(q.id);
    if (task) {
      if (q.status === 'done') task.status = 'done';
      if (q.status === 'skipped' || q.status === 'cut') task.debt = true;
    } else if (q.status !== 'done') {
      t.tasks.push({ id: `x${state.date}-${q.id}`, title: q.title, roleId: q.roleId, minutes: q.minutes, rank: q.rank, deadline: null, status: 'todo', debt: true, oneOff: true });
    }
  }
  return t;
}

const debtTasks = (t) => t.tasks.filter((x) => x.status === 'todo' && x.debt);

// Plan against reality for one week, by role.
export function weekReview(t) {
  const doneMin = (id) => t.done?.[id] || 0;
  return {
    weekStart: t.weekStart || null,
    roles: t.roles.map((r) => ({ id: r.id, name: r.name, targetMin: r.targetMin, floorMin: r.floorMin, doneMin: doneMin(r.id), floorKept: doneMin(r.id) >= r.floorMin })),
    goals: (t.goals || []).map((g) => ({ id: g.id, title: g.title, roleId: g.roleId, doneMin: doneMin(g.roleId) })),
    tasksDone: t.tasks.filter((x) => x.status === 'done').length,
    tasksTotal: t.tasks.length,
    debtMin: debtTasks(t).reduce((s, x) => s + x.minutes, 0),
  };
}

// Ends the week: stores its review and starts the next one. Debt stays debt,
// repeating blocks open again, one-off work that was finished is gone.
export function closeWeek(t, nextWeekStart) {
  const pastDue = (x) => x.deadline && x.deadline < nextWeekStart;
  const tasks = t.tasks
    .filter((x) => !(x.status === 'done' && (x.oneOff || x.deadline)))
    .map((x) => (x.status === 'done' ? { ...x, status: 'todo', debt: false } : { ...x, debt: x.debt || !!pastDue(x) }));
  return {
    ...t,
    tasks,
    history: [...(t.history || []), weekReview(t)].slice(-12),
    done: {},
    weekStart: nextWeekStart,
    actuals: (t.actuals || []).slice(-200),
  };
}

// Applies an approved next-week plan: new hours per role and new blocks.
// Debt from before always comes along. Goals, fixed events, sleep and
// floors are never touched by this.
export function adoptNext(t, next) {
  const hours = new Map(next.roles.map((r) => [r.id, r.targetMin]));
  return {
    ...t,
    roles: t.roles.map((r) => ({ ...r, targetMin: hours.get(r.id) ?? r.targetMin })),
    tasks: [...debtTasks(t), ...next.tasks],
    pending: null,
  };
}

// Called when a new day opens. Handles the day and, on a new week, the week.
export function rollover(template, prevState, { date, weekday, now }) {
  let t = prevState && prevState.date !== date ? absorbDay(template, prevState) : template;
  const week = mondayOf(date);
  let review = null;
  if (!t.weekStart) t = { ...t, weekStart: week };
  else if (t.weekStart !== week) {
    t = closeWeek(t, week);
    review = t.history.at(-1);
    if (t.pending) t = adoptNext(t, t.pending);
  }
  return { template: t, state: buildDay(t, { date, weekday, now }), review };
}

// Is each goal getting its share of the week so far? Today does not count
// yet, so Monday never warns. Below 70% of the pace it is flagged.
export function goalPace(t, { weekday, date }) {
  const daysPassed = (weekday + 6) % 7;
  return (t.goals || []).map((g) => {
    const r = t.roles.find((x) => x.id === g.roleId);
    const doneMin = t.done?.[g.roleId] || 0;
    const expectedMin = Math.round(((r?.targetMin || 0) * daysPassed) / 7);
    const daysLeft = g.deadline && date ? Math.round((Date.parse(g.deadline) - Date.parse(date)) / 86400000) : null;
    return { id: g.id, doneMin, targetMin: r?.targetMin || 0, expectedMin, behind: expectedMin > 0 && doneMin < expectedMin * 0.7, daysLeft };
  });
}

// Usable minutes in a normal week: free time times the 60% fill rule.
export function weekCapacityMin(t) {
  const settings = { wake: toMin(t.wake), sleep: toMin(t.sleep) };
  let total = 0;
  for (let wd = 0; wd < 7; wd++) {
    const fixed = t.fixed.filter((f) => f.days.includes(wd)).map((f) => ({ start: toMin(f.start), end: toMin(f.end) }));
    total += Math.floor(freeWindows(settings.wake, fixed, settings).reduce((s, [a, b]) => s + b - a, 0) * 0.6);
  }
  return total;
}

export const NEXT_WEEK_PROMPT = `You plan a person's next week from how the last one really went, by
calling plan_next_week exactly once.

- Goals, fixed events, sleep and weekly floors are not yours to change.
- roles: every role, with weeklyHours for next week and one short reason
  in the user's language. Move hours toward what really happened: a role
  that fell far short usually needs a smaller, honest target, or more of
  the week if it serves a goal that is behind. Never below its floor.
- tasks: new blocks of 30 to 120 minutes that cover each role's hours,
  minus the debt already carried over. rank 1 for the most important block
  of a role, then 2, 3, or "extra". Names in the user's language.
- Debt is carried over by code. Do not repeat it in tasks.
- Never use em dashes or en dashes.`;

export const PLAN_NEXT_WEEK = {
  type: 'function',
  function: {
    name: 'plan_next_week',
    description: 'Propose next week: hours per role and new work blocks.',
    parameters: {
      type: 'object',
      properties: {
        roles: { type: 'array', items: { type: 'object', properties: {
          name: { type: 'string' }, weeklyHours: { type: 'number' }, why: { type: 'string' },
        }, required: ['name', 'weeklyHours', 'why'] } },
        tasks: BUILD_WEEK.function.parameters.properties.tasks,
      },
      required: ['roles', 'tasks'],
    },
  },
};

// What the model sees about the week that ended.
export function nextWeekBrief(t, review) {
  const h = (m) => Math.round((m / 60) * 10) / 10;
  return JSON.stringify({
    roles: review.roles.map((r) => ({ name: r.name, targetHours: h(r.targetMin), floorHours: h(r.floorMin), doneHours: h(r.doneMin), floorKept: r.floorKept })),
    goals: (t.goals || []).map((g) => ({ title: g.title, role: t.roles.find((r) => r.id === g.roleId)?.name, deadline: g.deadline })),
    debt: debtTasks(t).map((x) => ({ title: x.title, role: t.roles.find((r) => r.id === x.roleId)?.name, minutes: x.minutes })),
    usableHoursPerWeek: h(weekCapacityMin(t)),
  });
}

// Checks plan_next_week. Returns { next } or { errors }. The total is held to
// what the week can really take (or the floors, if those alone are more).
export function validateNext(t, a) {
  if (!a || typeof a !== 'object') return { errors: ['Arguments were not valid JSON.'] };
  const errors = [];
  const given = new Map((Array.isArray(a.roles) ? a.roles : []).map((r) => [String(r?.name || '').trim().toLowerCase(), r]));
  const byName = new Map(t.roles.map((r) => [r.name.trim().toLowerCase(), r]));
  for (const name of given.keys()) if (!byName.has(name)) errors.push(`roles: "${name}" is not one of the roles. Do not add roles.`);
  const roles = [];
  for (const r of t.roles) {
    const g = given.get(r.name.trim().toLowerCase());
    if (!g) { errors.push(`roles: "${r.name}" is missing.`); continue; }
    const min = Math.round(g.weeklyHours * 60);
    if (!(min >= r.floorMin && min <= 80 * 60)) errors.push(`${r.name}: weeklyHours must be from its floor (${r.floorMin / 60}) to 80.`);
    roles.push({ id: r.id, name: r.name, fromMin: r.targetMin, targetMin: min, why: clean(g.why, '') });
  }
  const total = roles.reduce((s, r) => s + r.targetMin, 0);
  const limit = Math.max(weekCapacityMin(t), t.roles.reduce((s, r) => s + r.floorMin, 0));
  if (total > limit) errors.push(`Total ${total / 60} hours is more than the ${Math.floor(limit / 60)} usable hours in this week. Lower some roles.`);
  const list = Array.isArray(a.tasks) ? a.tasks : [];
  if (!list.length || list.length > 60) errors.push('tasks: give 1 to 60.');
  list.forEach((x, i) => {
    if (!byName.has(String(x?.role || '').trim().toLowerCase())) errors.push(`tasks[${i}].role "${x?.role}" is not one of the roles.`);
    if (!(Number.isInteger(x?.minutes) && x.minutes >= 15 && x.minutes <= 180)) errors.push(`tasks[${i}].minutes must be an integer from 15 to 180.`);
    if (!['1', '2', '3', 'extra'].includes(String(x?.rank))) errors.push(`tasks[${i}].rank must be 1, 2, 3 or extra.`);
    if (x?.deadline && !DATE.test(x.deadline)) errors.push(`tasks[${i}].deadline must be YYYY-MM-DD.`);
  });
  if (errors.length) return { errors };
  const tag = crypto.randomUUID().slice(0, 6);
  return {
    next: {
      roles,
      tasks: list.map((x, i) => ({
        id: `w${tag}-${i + 1}`, title: clean(x.title, 'Task'), roleId: byName.get(x.role.trim().toLowerCase()).id,
        minutes: x.minutes, rank: String(x.rank) === 'extra' ? 'extra' : Number(x.rank), deadline: x.deadline || null, status: 'todo',
      })),
    },
  };
}

// Checks a template the user edited by hand. Returns a list of problems,
// in the user's language because people read these directly.
export function checkTemplate(t, lang = 'en') {
  const m = (en, vi) => (lang === 'vi' ? vi : en);
  const errors = [];
  if (!t || !Array.isArray(t.roles) || !t.roles.length) return [m('At least one role is needed.', 'Cần ít nhất một vai trò.')];
  if (!HHMM.test(t.wake || '') || !HHMM.test(t.sleep || '') || toMin(t.sleep) <= toMin(t.wake)) errors.push(m('Sleep must be after wake.', 'Giờ ngủ phải sau giờ dậy.'));
  for (const r of t.roles) {
    if (!String(r.name || '').trim()) errors.push(m('Every role needs a name.', 'Vai trò nào cũng cần tên.'));
    if (!(r.targetMin >= 0 && r.targetMin <= 4800)) errors.push(m(`${r.name}: weekly hours must be 0 to 80.`, `${r.name}: giờ mỗi tuần phải từ 0 đến 80.`));
    if (!(r.floorMin >= 0 && r.floorMin <= r.targetMin)) errors.push(m(`${r.name}: the minimum cannot be more than the target.`, `${r.name}: mức tối thiểu không được lớn hơn mục tiêu giờ.`));
  }
  for (const f of t.fixed || []) {
    if (!String(f.title || '').trim()) errors.push(m('Every fixed event needs a title.', 'Lịch cố định nào cũng cần tên.'));
    if (!HHMM.test(f.start || '') || !HHMM.test(f.end || '') || toMin(f.end) <= toMin(f.start)) errors.push(m(`${f.title}: end must be after start.`, `${f.title}: giờ kết thúc phải sau giờ bắt đầu.`));
    if (!Array.isArray(f.days) || !f.days.length) errors.push(m(`${f.title}: pick at least one day.`, `${f.title}: chọn ít nhất một ngày.`));
  }
  const ids = new Set(t.roles.map((r) => r.id));
  for (const x of t.tasks || []) {
    if (!String(x.title || '').trim()) errors.push(m('Every task needs a title.', 'Việc nào cũng cần tên.'));
    if (!ids.has(x.roleId)) errors.push(m(`${x.title}: that role no longer exists.`, `${x.title}: vai trò này không còn.`));
    if (!(Number.isInteger(x.minutes) && x.minutes >= 15 && x.minutes <= 180)) errors.push(m(`${x.title}: minutes must be 15 to 180.`, `${x.title}: số phút phải từ 15 đến 180.`));
    if (x.deadline && !DATE.test(x.deadline)) errors.push(m(`${x.title}: bad deadline.`, `${x.title}: hạn chót không hợp lệ.`));
  }
  for (const g of t.goals || []) {
    if (!String(g.title || '').trim()) errors.push(m('Every goal needs a title.', 'Mục tiêu nào cũng cần tên.'));
    if (!ids.has(g.roleId)) errors.push(m(`${g.title}: that role no longer exists.`, `${g.title}: vai trò này không còn.`));
  }
  return errors;
}

export const CHECKIN_PROMPT = `You write a person's short morning check-in for a planning app.
You only read the plan; you change nothing and have no tools.

Say what comes first today, then the one thing that matters most: debt to
pay back, a goal falling behind, or work that does not fit today. End with
one simple question. At most 3 short sentences. Calm, no blame, no guilt
words. Use only what is in the data. Never use em dashes or en dashes. No
medical, mental health, nutrition or training advice.`;

// What the check-in may see: names and times, nothing about the account.
export function checkinBrief(t, view, { weekday, date }) {
  const pace = new Map(goalPace(t, { weekday, date }).map((g) => [g.id, g]));
  return JSON.stringify({
    first: view.queue.slice(0, 3).map((q) => ({ title: q.title, start: q.start })),
    fixedToday: view.fixed.map((f) => ({ title: f.title, start: f.start })),
    doesNotFit: view.doesNotFit.map((x) => x.title),
    debt: debtTasks(t).map((x) => ({ title: x.title, minutes: x.minutes })),
    goals: (t.goals || []).map((g) => ({ title: g.title, behind: pace.get(g.id)?.behind || false, daysLeft: pace.get(g.id)?.daysLeft ?? null })),
  });
}
