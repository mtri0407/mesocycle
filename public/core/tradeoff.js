// When a day no longer fits, the possible cuts are worked out here, by code.
// Each candidate already fits and keeps every weekly floor, so whatever the
// two guardians choose in src/council.js cannot break a rule.
import { applyEvent, replan } from './planner.js';
import { floorBroken } from './tools.js';

const RANK = { 1: 1, 2: 2, 3: 3, extra: 4 };
const POOL = 8; // only the least important items, so this stays cheap

function* subsets(items, size, from = 0, picked = []) {
  if (picked.length === size) { yield picked; return; }
  for (let i = from; i < items.length; i++) yield* subsets(items, size, i + 1, [...picked, items[i]]);
}

const fits = (state, ids) => !replan(applyEvent(state, { type: 'cut', ids })).needsUser && !floorBroken(state, ids).length;

export function tradeoffCandidates(state, { limit = 5 } = {}) {
  const plan = replan(state);
  if (!plan.needsUser) return [];
  const prio = (it) => state.roles.find((r) => r.id === it.roleId)?.priority ?? 99;
  const pool = state.queue.filter((i) => i.status === 'todo' && i.rank !== 1)
    .sort((a, b) => RANK[b.rank] - RANK[a.rank] || prio(b) - prio(a))
    .slice(0, POOL);

  // Smallest cuts first; a set that contains a working cut is not minimal. A
  // set that frees too few minutes cannot work, so it is skipped unchecked.
  const open = state.queue.filter((i) => i.status === 'todo').reduce((s, i) => s + i.minutes, 0);
  const need = open - plan.budgetMin;
  const found = [];
  for (let size = 1; size <= pool.length; size++) {
    for (const set of subsets(pool, size)) {
      if (set.reduce((s, i) => s + i.minutes, 0) < need) continue;
      const ids = set.map((i) => i.id);
      if (found.some((f) => f.every((id) => ids.includes(id)))) continue;
      if (fits(state, ids)) found.push(ids);
    }
  }
  const planned = plan.cuts;
  if (planned.length && fits(state, planned) && !found.some((f) => f.length === planned.length && f.every((id) => planned.includes(id)))) found.push(planned);

  const isLife = (it) => state.roles.find((r) => r.id === it.roleId)?.kind === 'life';
  const candidates = found.map((ids) => {
    const items = ids.map((id) => state.queue.find((q) => q.id === id));
    const lifeMin = items.filter(isLife).reduce((s, i) => s + i.minutes, 0);
    const minutes = items.reduce((s, i) => s + i.minutes, 0);
    return {
      ids,
      titles: items.map((i) => i.title),
      minutes,
      lifeMin,
      workMin: minutes - lifeMin,
      topRank: Math.min(...items.map((i) => RANK[i.rank])), // how important the most important item is
    };
  });

  // Keep a real spread: the gentlest on life, on work, and the smallest cut.
  const by = (...keys) => [...candidates].sort((a, b) => {
    for (const k of keys) if (a[k] !== b[k]) return k === 'topRank' ? b[k] - a[k] : a[k] - b[k];
    return 0;
  });
  const chosen = [];
  for (const list of [by('lifeMin', 'minutes'), by('workMin', 'minutes'), by('topRank', 'minutes'), by('minutes')]) {
    if (list[0] && !chosen.includes(list[0])) chosen.push(list[0]);
  }
  for (const c of by('minutes')) if (chosen.length < limit && !chosen.includes(c)) chosen.push(c);
  return chosen.slice(0, limit);
}
