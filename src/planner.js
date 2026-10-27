// Mesocycle planner core. Pure functions: same input, same output, no I/O.
// The model never edits the plan directly; its tool calls go through here,
// so the rules hold no matter what the model says.
// Times are minutes after midnight of the day being planned (0..1440).

export const DEFAULT_SETTINGS = Object.freeze({
  wake: 7 * 60,
  sleep: 23 * 60,   // hard: nothing is ever planned past this
  fillRatio: 0.6,   // plan at most 60% of free time, the rest absorbs reality
  bufferMin: 15,    // gap after each block
});

// Cut order when the day overflows: extra blocks first, then Block 3, 2, 1.
const RANK_ORDER = { 1: 1, 2: 2, 3: 3, extra: 4 };

export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// Free time between now and sleep, minus fixed events (classes, exams, meetings).
export function freeWindows(now, fixed, settings) {
  const start = Math.max(now, settings.wake);
  const end = settings.sleep;
  const busy = fixed
    .map((f) => [Math.max(f.start, start), Math.min(f.end, end)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  let cur = start;
  for (const [a, b] of busy) {
    if (a > cur) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (end > cur) out.push([cur, end]);
  return out;
}

function firstFit(windows, cursor, len) {
  for (const [a, b] of windows) {
    const s = Math.max(a, cursor);
    if (s + len <= b) return s;
  }
  return null;
}

// Lay items out in queue order. Times are estimates that slide when reality
// changes; only fixed events have hard times. An item that does not fit is
// left out, later items may still use the space (relative order is kept).
export function layout(items, windows, settings, budgetMin = Infinity) {
  const placed = [];
  const overflow = [];
  let cursor = windows.length ? windows[0][0] : 0;
  let used = 0;
  for (const it of items) {
    const s = used + it.minutes > budgetMin ? null : firstFit(windows, cursor, it.minutes);
    if (s === null) {
      overflow.push(it);
      continue;
    }
    placed.push({ id: it.id, roleId: it.roleId, start: s, end: s + it.minutes });
    cursor = s + it.minutes + settings.bufferMin;
    used += it.minutes;
  }
  return { placed, overflow, used };
}

// Minutes a role already has this week outside today's queue.
function baseMinutes(week, roleId) {
  const w = (week && week[roleId]) || {};
  return (w.done || 0) + (w.futureBudget || 0);
}

// Order in which items earn a place today. Items a role needs to reach its
// floor come first; the rest by rank (Block 1 before 2, 3, extra), then role priority.
function keepOrder(todo, roles, week) {
  const need = {};
  for (const r of roles) need[r.id] = (r.floorMin || 0) - baseMinutes(week, r.id);
  const first = [];
  for (const it of todo) {
    if ((need[it.roleId] || 0) > 0) {
      first.push(it);
      need[it.roleId] -= it.minutes;
    }
  }
  const prio = (id) => (roles.find((r) => r.id === id) || {}).priority ?? 99;
  const rest = todo
    .filter((it) => !first.includes(it))
    .map((it, i) => ({ it, i }))
    .sort((x, y) =>
      RANK_ORDER[x.it.rank] - RANK_ORDER[y.it.rank] ||
      prio(x.it.roleId) - prio(y.it.roleId) ||
      x.i - y.i)
    .map((x) => x.it);
  return [...first, ...rest];
}

// Re-plan today from `now`. Never moves fixed events, never plans past sleep,
// never fills more than fillRatio of free time. If not everything fits it
// does not cut anything itself: it returns a cut proposal for the user.
export function replan(state) {
  const settings = { ...DEFAULT_SETTINGS, ...state.settings };
  const roles = state.roles || [];
  const windows = freeWindows(state.now, state.fixed, settings);
  const freeMin = windows.reduce((sum, [a, b]) => sum + b - a, 0);
  const budgetMin = Math.floor(freeMin * settings.fillRatio);
  const todo = state.queue.filter((i) => i.status === 'todo');

  // Greedy by priority: an item is kept only if everything kept so far
  // still fits with it. So a lower-priority item never pushes out a higher one.
  let kept = [];
  const cuts = [];
  for (const it of keepOrder(todo, roles, state.week)) {
    const trial = todo.filter((x) => x === it || kept.includes(x));
    if (layout(trial, windows, settings, budgetMin).overflow.length === 0) kept = trial;
    else cuts.push(it);
  }
  const { placed, used } = layout(kept, windows, settings, budgetMin);

  // Never go below a floor silently: report every role a cut would push under it.
  const floorBreaches = roles
    .filter((r) => r.floorMin && cuts.some((c) => c.roleId === r.id))
    .filter((r) => {
      const today = placed.filter((p) => p.roleId === r.id).reduce((s, p) => s + p.end - p.start, 0);
      return baseMinutes(state.week, r.id) + today < r.floorMin;
    })
    .map((r) => r.id);

  return {
    placed,
    cuts: cuts.map((c) => c.id),
    floorBreaches,
    needsUser: cuts.length > 0,
    freeMin,
    budgetMin,
    usedMin: used,
  };
}

// The six things that happen in real life, as state changes.
//   late      { minutes }                       started late, nothing done
//   work      { id, minutes, finished, start? } worked on an item (overrun, early or partial)
//   interrupt { start, minutes, title }         something new with a hard time
//   skip      { id }                            did not do it, becomes debt
//   add       { item }                          new flexible work
//   cut       { ids }                           user approved a cut proposal, becomes debt
export function applyEvent(state, ev) {
  // Copy only what events change; the caller's state is never mutated.
  const s = {
    ...state,
    fixed: [...state.fixed],
    queue: state.queue.map((i) => ({ ...i })),
    actuals: [...(state.actuals || [])],
  };
  const item = ev.id ? s.queue.find((i) => i.id === ev.id) : null;
  if (ev.id && !item) throw new Error(`Unknown item: ${ev.id}`);

  switch (ev.type) {
    case 'late':
      s.now += ev.minutes;
      break;
    case 'work': {
      const start = Math.max(ev.start ?? s.now, s.now);
      s.now = start + ev.minutes;
      if (ev.finished) {
        s.actuals.push({ roleId: item.roleId, est: item.estimate ?? item.minutes, actual: (item.spent || 0) + ev.minutes });
        item.status = 'done';
      } else {
        item.spent = (item.spent || 0) + ev.minutes;
        item.minutes = Math.max(15, ev.remaining ?? item.minutes - ev.minutes);
      }
      break;
    }
    case 'interrupt': {
      const start = Math.max(ev.start, s.now);
      s.fixed.push({ id: ev.newId || `int-${s.fixed.length}`, title: ev.title || 'Interruption', start, end: start + ev.minutes });
      break;
    }
    case 'skip':
      item.status = 'skipped';
      break;
    case 'add':
      s.queue.push({ ...ev.item, status: 'todo' });
      break;
    case 'cut':
      for (const id of ev.ids) {
        const it = s.queue.find((i) => i.id === id);
        if (it && it.status === 'todo') it.status = 'cut';
      }
      break;
    default:
      throw new Error(`Unknown event: ${ev.type}`);
  }
  return s;
}

// Work that did not happen is not lost: it becomes debt owed to its role,
// paid back later when there is real free time (just-in-time planning).
export function debtByRole(queue) {
  const debt = {};
  for (const it of queue) {
    if (it.status === 'skipped' || it.status === 'cut') debt[it.roleId] = (debt[it.roleId] || 0) + it.minutes;
  }
  return debt;
}

// Learn how long things really take. Median of actual/estimate per role,
// needs 3 samples, clamped so one bad day cannot wreck the plan.
export function learnPace(actuals, { minSamples = 3, min = 0.8, max = 2 } = {}) {
  const byRole = {};
  for (const a of actuals) (byRole[a.roleId] = byRole[a.roleId] || []).push(a.actual / a.est);
  const pace = {};
  for (const [roleId, ratios] of Object.entries(byRole)) {
    if (ratios.length < minSamples) continue;
    const sorted = [...ratios].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    pace[roleId] = Math.min(max, Math.max(min, Math.round(median * 100) / 100));
  }
  return pace;
}

// Estimate adjusted by learned pace, rounded to 5 minutes, with the reason shown to the user.
export function adjustEstimate(minutes, ratio = 1) {
  const adjusted = Math.round((minutes * ratio) / 5) * 5;
  const pct = Math.round((ratio - 1) * 100);
  const why = pct === 0 ? '' : `You usually take ${Math.abs(pct)}% ${pct > 0 ? 'longer' : 'less'} on this, planned ${adjusted} min instead of ${minutes}.`;
  return { minutes: adjusted, why };
}

// Is a deadline still safe? Compares work left with usable time left.
export function deadlineRisk({ needMin, days, fillRatio = DEFAULT_SETTINGS.fillRatio }) {
  const capacityMin = days.reduce((s, d) => s + Math.floor(d.freeMin * fillRatio), 0);
  return { ok: capacityMin >= needMin, capacityMin, shortMin: Math.max(0, needMin - capacityMin) };
}
