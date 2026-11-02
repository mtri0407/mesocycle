// A goal in phases: blocks of a few weeks, each with one focus, the hours it
// gets a week and the result expected at its end. That block of weeks is what
// a mesocycle is. Pure, like the rest of the core: browser and Worker alike.
//
// phase: { id, title, start, end, weeklyMin, expect, applied?, retro? }
//   weeklyMin  hours a week for the goal's role while the phase runs (minutes)
//   applied    the week its hours became the role's target, so it happens once
//   retro      { verdict: 'reached' | 'partly' | 'not', at } once it has ended

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
export const plusDays = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const DASHES = new RegExp('\\s*[' + String.fromCharCode(0x2013, 0x2014) + ']\\s*', 'g');
const clean = (s, max = 120) => String(s ?? '').replace(DASHES, ': ').trim().slice(0, max);
export const MAX_PHASES = 8;

// Every problem with the phases of a template, so a person can fix all at once.
export function phaseErrors(t, lang = 'en') {
  const m = (en, vi) => (lang === 'vi' ? vi : en);
  const errors = [];
  for (const g of t.goals || []) {
    const phases = g.phases || [];
    if (!phases.length) continue;
    if (phases.length > MAX_PHASES) errors.push(m(`${g.title}: at most ${MAX_PHASES} phases.`, `${g.title}: tối đa ${MAX_PHASES} giai đoạn.`));
    const role = t.roles.find((r) => r.id === g.roleId);
    for (const p of phases) {
      const name = p.title || g.title;
      if (!clean(p.title)) errors.push(m(`${g.title}: every phase needs a name.`, `${g.title}: giai đoạn nào cũng cần tên.`));
      if (!DATE.test(p.start || '') || !DATE.test(p.end || '') || p.end < p.start) errors.push(m(`${name}: the phase must end after it starts.`, `${name}: giai đoạn phải kết thúc sau khi bắt đầu.`));
      if (p.weeklyMin != null && !(Number.isInteger(p.weeklyMin) && p.weeklyMin >= 0 && p.weeklyMin <= 4800)) errors.push(m(`${name}: hours a week must be 0 to 80.`, `${name}: giờ mỗi tuần phải từ 0 đến 80.`));
      else if (p.weeklyMin != null && role && p.weeklyMin < (role.floorMin || 0)) errors.push(m(`${name}: hours a week cannot go under the weekly minimum of ${role.name}.`, `${name}: giờ mỗi tuần không được thấp hơn mức tối thiểu của ${role.name}.`));
    }
    const sorted = [...phases].filter((p) => DATE.test(p.start || '') && DATE.test(p.end || '')).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= sorted[i - 1].end) errors.push(m(`${g.title}: phases overlap (${sorted[i - 1].title}, ${sorted[i].title}).`, `${g.title}: hai giai đoạn chồng nhau (${sorted[i - 1].title}, ${sorted[i].title}).`));
    }
  }
  return errors;
}

export const phaseOn = (goal, date) => (goal.phases || []).find((p) => p.start <= date && date <= p.end) || null;

// When a phase begins, its hours become the role's weekly target. That happens
// once per phase, so a target the person changes afterwards stays theirs.
// Two goals of one role starting a phase the same week: the later goal wins.
export function applyPhases(t, weekStart) {
  if (!weekStart || !(t.goals || []).some((g) => g.phases?.length)) return t;
  const weekEnd = plusDays(weekStart, 6);
  let roles = t.roles;
  let changed = false;
  const goals = t.goals.map((g) => {
    if (!g.phases?.length) return g;
    const phases = g.phases.map((p) => {
      if (p.applied || p.weeklyMin == null || p.start > weekEnd || p.end < weekStart) return p;
      roles = roles.map((r) => (r.id === g.roleId ? { ...r, targetMin: Math.max(r.floorMin || 0, p.weeklyMin) } : r));
      changed = true;
      return { ...p, applied: weekStart };
    });
    return { ...g, phases };
  });
  return changed ? { ...t, roles, goals } : t;
}

// How each phase of a goal is going: closed weeks plus this week so far.
export function phaseProgress(t, goal, today) {
  const weeks = [...(t.history || []), { weekStart: t.weekStart, roles: t.roles.map((r) => ({ id: r.id, doneMin: t.done?.[r.id] || 0 })) }]
    .filter((w) => w.weekStart);
  return (goal.phases || []).map((p) => {
    const inside = weeks.filter((w) => w.weekStart <= p.end && plusDays(w.weekStart, 6) >= p.start);
    const doneMin = inside.reduce((s, w) => s + (w.roles.find((r) => r.id === goal.roleId)?.doneMin || 0), 0);
    const totalWeeks = Math.max(1, Math.round(((ms(p.end) - ms(p.start)) / DAY + 1) / 7));
    const stage = today < p.start ? 'next' : today > p.end ? 'ended' : 'now';
    return {
      id: p.id,
      stage,
      weeks: totalWeeks,
      weekNo: stage === 'now' ? Math.min(totalWeeks, Math.floor((ms(today) - ms(p.start)) / (7 * DAY)) + 1) : null,
      doneMin,
      perWeekMin: inside.length ? Math.round(doneMin / inside.length) : 0,
      needsRetro: stage === 'ended' && !p.retro,
    };
  });
}

// Keeps what has already happened: phases that ended stay, the rest is replaced.
export function replacePhases(goal, phases, today) {
  const kept = (goal.phases || []).filter((p) => p.end < today);
  return { ...goal, phases: [...kept, ...phases] };
}

export const PHASES_PROMPT = `You split a person's long-term goal into phases for a time-planning app,
the way a coach splits a season into blocks of a few weeks, by calling
plan_phases exactly once.

- 2 to 5 phases, each 2 to 8 weeks. The first starts today. Each phase
  starts the day after the previous one ends: no gaps, no overlaps. The
  last ends by the deadline, or after about 12 weeks if there is none.
- Each phase has one focus, in its title, and a concrete result that can be
  checked at its end, in expect, in at most 20 words. Use the person's own
  measure when given.
- weeklyHours: never under the role's weekly minimum, never over the usable
  hours of a week. Build up gradually when it makes sense.
- Plan time only: what to work on and for how long. No medical, mental
  health, nutrition or training advice. For a health goal, phases are about
  time and habits, never exercises or programs.
- Write in the user's language. Vietnamese always with full diacritics,
  as a Vietnamese person writes it. Never use em dashes or en dashes.`;

export const PLAN_PHASES = {
  type: 'function',
  function: {
    name: 'plan_phases',
    description: 'Split one goal into phases of a few weeks each.',
    parameters: {
      type: 'object',
      properties: {
        phases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The focus of this phase, short' },
              start: { type: 'string', description: 'YYYY-MM-DD' },
              end: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
              weeklyHours: { type: 'number' },
              expect: { type: 'string', description: 'The result expected at the end of the phase' },
            },
            required: ['title', 'start', 'end', 'weeklyHours', 'expect'],
          },
        },
      },
      required: ['phases'],
    },
  },
};

// What the model sees about the goal.
export function phasesBrief(t, goal, { today, capacityMin }) {
  const role = t.roles.find((r) => r.id === goal.roleId);
  const h = (m) => Math.round((m / 60) * 10) / 10;
  return JSON.stringify({
    today,
    goal: { title: goal.title, measure: goal.measure || null, deadline: goal.deadline || null },
    role: { name: role?.name, weeklyHoursNow: h(role?.targetMin || 0), weeklyMinimumHours: h(role?.floorMin || 0) },
    usableHoursPerWeek: h(capacityMin),
  });
}

// Checks plan_phases. Returns { phases } or { errors }, every error at once.
export function validatePhases(a, { goal, role, today, capacityMin }) {
  if (!a || typeof a !== 'object' || !Array.isArray(a.phases)) return { errors: ['phases must be a list.'] };
  const errors = [];
  if (a.phases.length < 1 || a.phases.length > 6) errors.push('Give 2 to 5 phases.');
  const floor = role?.floorMin || 0;
  const ceiling = Math.max(capacityMin || 0, floor);
  const phases = a.phases.slice(0, 6).map((p, i) => {
    const label = `phase ${i + 1}`;
    if (!clean(p?.title)) errors.push(`${label}: title is required.`);
    if (!DATE.test(p?.start || '') || !DATE.test(p?.end || '')) errors.push(`${label}: start and end must be YYYY-MM-DD.`);
    else {
      const days = (ms(p.end) - ms(p.start)) / DAY + 1;
      if (days < 7 || days > 63) errors.push(`${label}: must last 1 to 9 weeks, it lasts ${Math.round(days)} days.`);
    }
    const min = Math.round((Number(p?.weeklyHours) * 60) / 15) * 15;
    if (!Number.isFinite(min) || min < floor) errors.push(`${label}: weeklyHours must be at least ${floor / 60}, the weekly minimum.`);
    else if (min > ceiling) errors.push(`${label}: weeklyHours must be at most ${Math.floor(ceiling / 60)}, what a week can hold.`);
    if (!clean(p?.expect)) errors.push(`${label}: expect is required.`);
    return { id: `${goal.id}-p${i + 1}-${String(today).replace(/-/g, '')}`, title: clean(p?.title, 60), start: p?.start, end: p?.end, weeklyMin: min, expect: clean(p?.expect, 200) };
  });
  if (phases[0] && DATE.test(phases[0].start || '') && phases[0].start !== today) errors.push(`phase 1 must start today, ${today}.`);
  for (let i = 1; i < phases.length; i++) {
    if (DATE.test(phases[i - 1].end || '') && phases[i].start !== plusDays(phases[i - 1].end, 1)) errors.push(`phase ${i + 1} must start ${plusDays(phases[i - 1].end, 1)}, the day after phase ${i} ends.`);
  }
  const last = phases.at(-1);
  if (goal.deadline && last?.end && last.end > goal.deadline) errors.push(`the last phase must end by the deadline, ${goal.deadline}.`);
  return errors.length ? { errors } : { phases };
}
