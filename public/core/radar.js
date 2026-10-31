// Will each deadline be met? Work with a deadline is laid out day by day,
// earliest deadline first, in the time the 60% rule leaves. Everything else is
// ignored on purpose: this answers "can it still be done if it comes first?".
// The agent reads the answer instead of guessing it.
import { replan, adjustEstimate, learnPace, freeWindows, toMin, sleepMinutes } from './planner.js';
import { addDays, fixedOn } from './setup.js';

const FILL = 0.6;
const HORIZON_DAYS = 90;

export function deadlineRadar(template, state, { date, weekday }) {
  const pace = learnPace(template.actuals || []);
  const work = template.tasks
    .filter((t) => t.status === 'todo' && t.deadline)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .map((t) => ({ t, left: adjustEstimate(t.minutes, pace[t.roleId] ?? 1).minutes, finish: null, short: null }));
  if (!work.length) return [];

  const settings = { wake: toMin(template.wake), sleep: sleepMinutes(template.wake, template.sleep) };
  const last = work.at(-1).t.deadline;
  let day = date;
  let wd = weekday;
  for (let i = 0; i < HORIZON_DAYS && day <= last; i++) {
    let room = i === 0
      ? replan(state).budgetMin
      : Math.floor(freeWindows(settings.wake, fixedOn(template, wd, day), settings).reduce((s, [a, b]) => s + b - a, 0) * FILL);
    for (const w of work) {
      if (!room) break;
      if (!w.left) continue;
      const use = Math.min(room, w.left);
      w.left -= use;
      room -= use;
      if (!w.left) w.finish = day;
    }
    for (const w of work) if (w.t.deadline === day) w.short = w.left;
    day = addDays(day, 1);
    wd = (wd + 1) % 7;
  }

  return work.map(({ t, left, finish, short }) => {
    const shortMin = short ?? left; // a deadline already behind us never got a turn
    return { id: t.id, title: t.title, date: t.deadline, ok: shortMin === 0, shortMin, finishDate: finish };
  });
}
