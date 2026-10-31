// The only buttons the model can press. Each tool checks its arguments,
// changes a copy of the state through planner.js, and answers in plain JSON.
// A rejected call returns { ok: false, error } so the model can read the
// reason and try something else; the state is left untouched.
import { DEFAULT_SETTINGS, replan, applyEvent, debtByRole, deadlineRisk, baseMinutes, toMin, toHHMM } from './planner.js';

export const TOOL_DEFS = [
  {
    name: 'get_state',
    description: 'Today so far: fixed events, the flexible queue with estimated times, debt per role, weekly floors and deadline risk. Call this first.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_fixed',
    description: 'Add something with a hard time today (meeting, extra class, appointment). Flexible work moves around it.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'HH:MM, 24h' },
        minutes: { type: 'integer' },
      },
      required: ['title', 'start', 'minutes'],
    },
  },
  {
    name: 'update_item',
    description: 'Report what happened to a queue item: done, skipped (becomes debt), or needs more time.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['done', 'skipped', 'more_time'] },
        minutes: { type: 'integer', description: 'For done: real minutes spent. For more_time: extra minutes needed.' },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'add_item',
    description: 'Add flexible work to today\'s queue.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        role: { type: 'string', description: 'Role id from get_state' },
        minutes: { type: 'integer' },
        rank: { type: 'string', enum: ['1', '2', '3', 'extra'] },
      },
      required: ['title', 'role', 'minutes', 'rank'],
    },
  },
  {
    name: 'reorder',
    description: 'Set the order of today\'s remaining queue. Give every todo id exactly once.',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
  {
    name: 'propose',
    description: 'Ask the user to approve cutting work from today (it becomes debt). Use only when get_state shows needsUser. Give a default and, if possible, an alternative.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'One or two short sentences for the user.' },
        cut_ids: { type: 'array', items: { type: 'string' } },
        alternative_cut_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['message', 'cut_ids'],
    },
  },
];

// OpenAI-style tool list for the model API.
export const TOOLS = TOOL_DEFS.map((t) => ({ type: 'function', function: t }));

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const reject = (error) => ({ ok: false, error });
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function summary(state) {
  const plan = replan(state);
  const title = (id) => state.queue.find((i) => i.id === id)?.title || id;
  return {
    now: toHHMM(state.now),
    sleep: toHHMM({ ...DEFAULT_SETTINGS, ...state.settings }.sleep),
    fixed: state.fixed.filter((f) => f.end > state.now).map((f) => ({ title: f.title, start: toHHMM(f.start), end: toHHMM(f.end) })),
    queue: plan.placed.map((p) => {
      const it = state.queue.find((i) => i.id === p.id);
      return { id: p.id, title: it.title, role: it.roleId, rank: String(it.rank), start: toHHMM(p.start), end: toHHMM(p.end) };
    }),
    doesNotFit: plan.cuts.map((id) => ({ id, title: title(id) })),
    needsUser: plan.needsUser,
    cutOptions: plan.needsUser ? cutOptions(state, plan) : [],
    budgetMin: plan.budgetMin,
    usedMin: plan.usedMin,
    floorAtRisk: plan.floorBreaches,
    debtMinutes: debtByRole(state.queue),
    roles: state.roles.map((r) => ({ id: r.id, name: r.name, priority: r.priority, floorMin: r.floorMin || 0, weekSoFarMin: (state.week[r.id]?.done) || 0 })),
    deadlines: (state.deadlines || []).map((d) => ({ title: d.title, date: d.date, ...deadlineRisk({ needMin: d.remainingMin, days: d.days, fillRatio: { ...DEFAULT_SETTINGS, ...state.settings }.fillRatio }) })),
  };
}

// Valid cut proposals worked out by code, so the model can choose and
// explain instead of guessing and getting rejected (each rejection costs a
// model round trip). Option 1 is the planner's own cut. Option 2 is a swap:
// keep the most important cut item and drop the least important kept work.
const RANK = { 1: 1, 2: 2, 3: 3, extra: 4 };
function cutOptions(state, plan) {
  const item = (id) => state.queue.find((i) => i.id === id);
  const prio = (it) => state.roles.find((r) => r.id === it.roleId)?.priority ?? 99;
  // Negative when a is more important than b.
  const cmp = (a, b) => RANK[a.rank] - RANK[b.rank] || prio(a) - prio(b);
  const valid = (ids) => ids.length && !replan(applyEvent(state, { type: 'cut', ids })).needsUser && !floorBroken(state, ids).length;
  const options = valid(plan.cuts) ? [plan.cuts] : [];

  const save = plan.cuts.map(item).sort(cmp)[0];
  if (save) {
    const rest = plan.cuts.filter((id) => id !== save.id);
    // Kept work, least important first; Block 1 items are never swapped out.
    const kept = plan.placed.map((p) => item(p.id)).filter((it) => it.rank !== 1).sort((a, b) => cmp(b, a));
    const dropped = [];
    for (const it of kept) {
      dropped.push(it.id);
      const alt = [...rest, ...dropped];
      if (valid(alt)) {
        if (alt.slice().sort().join() !== plan.cuts.slice().sort().join()) options.push(alt);
        break;
      }
    }
  }
  return options.map((ids) => ids.map((id) => ({ id, title: item(id).title })));
}

// Would cutting these items push a role under its floor?
function floorBroken(state, ids) {
  const plan = replan(applyEvent(state, { type: 'cut', ids }));
  const after = Object.fromEntries(state.roles.map((r) => [r.id, baseMinutes(state.week, r.id)]));
  for (const p of plan.placed) after[p.roleId] += p.end - p.start;
  return state.roles.filter((r) => r.floorMin && after[r.id] < r.floorMin && ids.some((id) => state.queue.find((i) => i.id === id)?.roleId === r.id));
}

// Runs one tool call. Returns { ok, result | error, state, proposal? }.
export function runTool(state, name, args) {
  if (args === null || typeof args !== 'object') return { ...reject('Arguments were not valid JSON.'), state };
  const todoIds = new Set(state.queue.filter((i) => i.status === 'todo').map((i) => i.id));
  const done = (next, extra = {}) => ({ ok: true, result: summary(next), state: next, ...extra });

  switch (name) {
    case 'get_state':
      return done(state);

    case 'add_fixed': {
      const { title, start, minutes } = args;
      if (typeof title !== 'string' || !title.trim()) return { ...reject('title is required.'), state };
      if (!HHMM.test(start || '')) return { ...reject('start must be HH:MM (24h).'), state };
      if (!intIn(minutes, 5, 600)) return { ...reject('minutes must be an integer from 5 to 600.'), state };
      if (toMin(start) + minutes <= state.now) return { ...reject(`That ends before now (${toHHMM(state.now)}).`), state };
      const next = applyEvent(state, { type: 'interrupt', start: toMin(start), minutes, title: title.trim(), newId: `fix-${state.fixed.length + 1}` });
      return done(next);
    }

    case 'update_item': {
      const { id, status, minutes } = args;
      if (!todoIds.has(id)) return { ...reject(`No open item with id "${id}". Use ids from get_state.`), state };
      if (status === 'skipped') return done(applyEvent(state, { type: 'skip', id }));
      if (status === 'done') {
        const it = state.queue.find((i) => i.id === id);
        const spent = intIn(minutes, 1, 600) ? minutes : it.minutes;
        const next = applyEvent(state, { type: 'work', id, minutes: 0, finished: true });
        next.actuals[next.actuals.length - 1].actual = spent;
        return done(next);
      }
      if (status === 'more_time') {
        if (!intIn(minutes, 5, 240)) return { ...reject('more_time needs minutes from 5 to 240.'), state };
        const next = { ...state, queue: state.queue.map((i) => (i.id === id ? { ...i, minutes: i.minutes + minutes } : i)) };
        return done(next);
      }
      return { ...reject('status must be done, skipped or more_time.'), state };
    }

    case 'add_item': {
      const { title, role, minutes, rank } = args;
      if (typeof title !== 'string' || !title.trim()) return { ...reject('title is required.'), state };
      if (!state.roles.some((r) => r.id === role)) return { ...reject(`Unknown role "${role}". Roles: ${state.roles.map((r) => r.id).join(', ')}.`), state };
      if (!intIn(minutes, 5, 300)) return { ...reject('minutes must be an integer from 5 to 300.'), state };
      if (!['1', '2', '3', 'extra'].includes(String(rank))) return { ...reject('rank must be 1, 2, 3 or extra.'), state };
      const item = { id: `q-${state.queue.length + 1}`, title: title.trim(), roleId: role, minutes, rank: rank === 'extra' ? 'extra' : Number(rank) };
      return done(applyEvent(state, { type: 'add', item }));
    }

    case 'reorder': {
      const ids = args.ids;
      if (!Array.isArray(ids) || ids.length !== todoIds.size || new Set(ids).size !== ids.length || !ids.every((id) => todoIds.has(id))) {
        return { ...reject(`ids must list every open item exactly once: ${[...todoIds].join(', ')}.`), state };
      }
      const open = ids.map((id) => state.queue.find((i) => i.id === id));
      const rest = state.queue.filter((i) => i.status !== 'todo');
      return done({ ...state, queue: [...rest, ...open] });
    }

    case 'propose': {
      const { message, cut_ids: cut, alternative_cut_ids: alt = [] } = args;
      if (typeof message !== 'string' || !message.trim()) return { ...reject('message is required.'), state };
      for (const ids of [cut, alt]) {
        if (!Array.isArray(ids) || !ids.every((id) => todoIds.has(id))) return { ...reject('cut ids must be open item ids from get_state.'), state };
      }
      if (!cut.length) return { ...reject('cut_ids is empty.'), state };
      if (alt.length && [...cut].sort().join() === [...alt].sort().join()) return { ...reject('alternative_cut_ids is the same as cut_ids. Offer a different option or leave it out.'), state };
      // Every option must make the day fit. Checked here, not trusted from the model.
      for (const [label, ids] of [['cut_ids', cut], ['alternative_cut_ids', alt]]) {
        if (ids.length && replan(applyEvent(state, { type: 'cut', ids })).needsUser) {
          return { ...reject(`After ${label} the day still does not fit. Cut more, starting with extra blocks.`), state };
        }
      }
      for (const [label, ids] of [['cut_ids', cut], ['alternative_cut_ids', alt]]) {
        const broken = ids.length ? floorBroken(state, ids) : [];
        if (broken.length) return { ...reject(`${label} would push ${broken.map((r) => r.name || r.id).join(', ')} under its weekly floor. Choose other items.`), state };
      }
      const proposal = { message: message.trim(), options: [cut, ...(alt.length ? [alt] : [])] };
      return done(state, { proposal });
    }

    default:
      return { ...reject(`Unknown tool "${name}".`), state };
  }
}
