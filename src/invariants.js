// The promises Mesocycle makes, written as checks. The simulator runs them
// after every re-plan; any broken promise is a bug in the planner.
import { DEFAULT_SETTINGS, freeWindows, layout } from './planner.js';

export function checkPlan(state, result, originalFixed = state.fixed) {
  const errors = [];
  const settings = { ...DEFAULT_SETTINGS, ...state.settings };
  const todo = state.queue.filter((i) => i.status === 'todo');
  const placed = [...result.placed].sort((a, b) => a.start - b.start);

  // 1. Sleep is untouched and nothing starts in the past.
  for (const p of placed) {
    if (p.end > settings.sleep) errors.push(`sleep: ${p.id} ends at ${p.end} after sleep ${settings.sleep}`);
    if (p.start < settings.wake) errors.push(`wake: ${p.id} starts before wake`);
    if (p.start < state.now) errors.push(`past: ${p.id} starts before now`);
  }

  // 2. No overlap with fixed events or with each other.
  for (const p of placed) {
    for (const f of state.fixed) {
      if (p.start < f.end && f.start < p.end) errors.push(`overlap: ${p.id} overlaps fixed ${f.id}`);
    }
  }
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].start < placed[i - 1].end) errors.push(`overlap: ${placed[i - 1].id} and ${placed[i].id}`);
  }

  // 3. Fixed events the user set are never moved or removed.
  for (const f of originalFixed) {
    const now = state.fixed.find((x) => x.id === f.id);
    if (!now || now.start !== f.start || now.end !== f.end) errors.push(`fixed moved: ${f.id}`);
  }

  // 4. Nothing silently disappears: every todo item is placed or proposed for a cut, never both.
  const placedIds = new Set(placed.map((p) => p.id));
  const cutIds = new Set(result.cuts);
  for (const it of todo) {
    const inP = placedIds.has(it.id);
    const inC = cutIds.has(it.id);
    if (inP === inC) errors.push(`lost: ${it.id} placed=${inP} cut=${inC}`);
  }

  // 5. The day is never filled past the fill ratio.
  if (result.usedMin > result.budgetMin) errors.push(`overfilled: ${result.usedMin} > ${result.budgetMin}`);

  // 6. The planner never cuts on its own: any cut must be a question to the user.
  if (result.cuts.length && !result.needsUser) errors.push('silent cut');

  // 7. A cut is only proposed when it really does not fit next to the higher-priority work kept.
  const windows = freeWindows(state.now, state.fixed, settings);
  for (const id of result.cuts) {
    const it = todo.find((x) => x.id === id);
    const trial = todo.filter((x) => x === it || placedIds.has(x.id));
    if (layout(trial, windows, settings, result.budgetMin).overflow.length === 0) {
      errors.push(`needless cut: ${id} still fits`);
    }
  }

  // 8. Going below a floor is never silent.
  for (const r of state.roles || []) {
    if (!r.floorMin || !result.cuts.some((id) => todo.find((t) => t.id === id)?.roleId === r.id)) continue;
    const w = (state.week && state.week[r.id]) || {};
    const today = placed.filter((p) => p.roleId === r.id).reduce((s, p) => s + p.end - p.start, 0);
    if ((w.done || 0) + (w.futureBudget || 0) + today < r.floorMin && !result.floorBreaches.includes(r.id)) {
      errors.push(`silent floor breach: ${r.id}`);
    }
  }

  return errors;
}
