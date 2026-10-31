// What really changed, worked out by code from the two plans. The model's
// words are only its summary of this; the app shows both side by side.
import { view } from './handlers.js';

export function planDiff(beforeState, afterState, beforeWeek = null, afterWeek = null) {
  const a = view(beforeState);
  const b = view(afterState);
  const placedBefore = new Map(a.queue.map((q) => [q.id, q]));
  const existed = new Set(beforeState.queue.map((q) => q.id));
  const status = new Map(afterState.queue.map((q) => [q.id, q.status]));
  const titled = (list) => list.map((q) => q.title);
  const newIn = (name) => {
    const had = new Set((beforeWeek?.[name] || []).map((x) => x.id));
    return (afterWeek?.[name] || []).filter((x) => !had.has(x.id)).map((x) => ({ title: x.title, deadline: x.deadline, on: x.on, start: x.start }));
  };
  return {
    added: b.queue.filter((q) => !existed.has(q.id)).map((q) => ({ title: q.title, start: q.start })),
    moved: b.queue.filter((q) => placedBefore.has(q.id) && placedBefore.get(q.id).start !== q.start)
      .map((q) => ({ title: q.title, from: placedBefore.get(q.id).start, to: q.start })),
    fixedAdded: b.fixed.filter((f) => !a.fixed.some((x) => x.title === f.title && x.start === f.start)).map((f) => ({ title: f.title, start: f.start })),
    toDebt: titled(beforeState.queue.filter((q) => q.status === 'todo' && ['skipped', 'cut'].includes(status.get(q.id)))),
    finished: titled(beforeState.queue.filter((q) => q.status === 'todo' && status.get(q.id) === 'done')),
    noRoom: titled(b.doesNotFit.filter((x) => !a.doesNotFit.some((y) => y.id === x.id))),
    laterTasks: newIn('tasks'),
    laterEvents: newIn('fixed'),
    goals: newIn('goals'),
  };
}

export const isEmptyDiff = (d) => Object.values(d).every((v) => !v.length);
