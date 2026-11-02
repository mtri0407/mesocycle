// Reads a data file from Greysteel Tasks, the author's planner from before the
// hackathon, into a Mesocycle week. Written for Mesocycle; no code of that app
// is used. It runs on the device and nothing is sent anywhere. Only what
// Mesocycle plans with is read: goals and their phases, the weekly blocks,
// open tasks, sleep and focus sessions. Notes and people are never read.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DASHES = new RegExp('\\s*[' + String.fromCharCode(0x2013, 0x2014) + ']\\s*', 'g');
const clean = (s, max = 80) => String(s ?? '').replace(DASHES, ': ').trim().slice(0, max);
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const live = (x) => x && typeof x === 'object' && !x.deletedAt;
const LIFE = /gym|tập|thể thao|sức khoẻ|sức khỏe|health|fitness|sport|quan hệ|gia đình|bạn bè|family|friend|people|người thân|nghỉ|rest/i;
const HOURS = /giờ|gio|hour|h\b/i;

export function isGreysteel(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Array.isArray(data.blockTemplates) || Array.isArray(data.focusSessions) || (Array.isArray(data.goals) && data.goals.some((g) => g && (Array.isArray(g.phases) || 'timeBudgetMinPerWeek' in g)));
}

// Blocks of the weekly template become Mesocycle work blocks of at most two
// hours. Fixed ones become fixed events, grouped by title and time.
function fromTemplates(templates, roleOf) {
  const fixed = new Map();
  const tasks = [];
  let skipped = 0;
  for (const b of templates.filter(live)) {
    if (!HHMM.test(b.start || '') || !HHMM.test(b.end || '') || b.endNextDay || toMin(b.end) <= toMin(b.start)) { skipped++; continue; }
    const title = clean(b.label) || 'Block';
    if (b.type === 'fixed') {
      const key = `${title}|${b.start}|${b.end}`;
      const f = fixed.get(key) || { title, start: b.start, end: b.end, days: [] };
      if (!f.days.includes(Number(b.weekday))) f.days.push(Number(b.weekday));
      fixed.set(key, f);
      continue;
    }
    const roleId = roleOf(b.goalId);
    if (!roleId) { skipped++; continue; }
    const total = toMin(b.end) - toMin(b.start);
    const parts = Math.ceil(total / 120);
    for (let i = 1; i <= parts; i++) {
      tasks.push({ title: parts > 1 ? `${title} (${i}/${parts})` : title, roleId, minutes: Math.min(180, Math.max(15, Math.round(total / parts / 5) * 5)), rank: b.type === 'protected' ? 1 : 2, protected: b.type === 'protected' });
    }
  }
  return { fixed: [...fixed.values()].map((f, i) => ({ id: `gf${i + 1}`, ...f, days: f.days.sort() })), tasks, skipped };
}

// The sleep rule that covers the most days decides wake and sleep.
function sleepOf(settings) {
  const rules = (settings?.sleepRules || []).filter((r) => HHMM.test(r?.start || '') && HHMM.test(r?.end || ''));
  const main = rules.sort((a, b) => (b.wakeWeekdays?.length || 0) - (a.wakeWeekdays?.length || 0))[0];
  if (!main) return { wake: '07:00', sleep: '23:00' };
  const sleep = toMin(main.start) < 240 || toMin(main.start) > toMin(main.end) ? main.start : '23:00';
  return { wake: main.end, sleep };
}

export function fromGreysteel(data, { today }) {
  const goals = (data.goals || []).filter(live);
  const templates = data.blockTemplates || [];
  const weekMin = (goalId, types) => templates.filter(live).filter((b) => b.goalId === goalId && types.includes(b.type) && HHMM.test(b.start || '') && HHMM.test(b.end || '') && toMin(b.end) > toMin(b.start))
    .reduce((s, b) => s + toMin(b.end) - toMin(b.start), 0);

  // Areas of life with a rank or a weekly budget are roles. A roadmap goal with
  // no role of its own gets one, named after it.
  const areas = goals.filter((g) => g.rank != null || g.timeBudgetMinPerWeek != null).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const roadmaps = goals.filter((g) => Array.isArray(g.phases) || g.targetValue != null);
  const roles = [];
  const roleByGoal = new Map();
  const addRole = (g, name) => {
    if (roles.length >= 8) return null;
    const id = `r${roles.length + 1}`;
    const floorMin = weekMin(g.id, ['protected']);
    const target = Math.max(floorMin, Number(g.timeBudgetMinPerWeek) || weekMin(g.id, ['protected', 'flexible']));
    roles.push({ id, name: clean(name, 40), priority: roles.length + 1, targetMin: Math.min(4800, Math.round(target / 15) * 15), floorMin: Math.min(4800, Math.round(floorMin / 15) * 15), kind: LIFE.test(`${name} ${g.area || ''}`) ? 'life' : 'commitment' });
    roleByGoal.set(g.id, id);
    return id;
  };
  for (const g of areas) addRole(g, g.title);
  const byName = (title) => roles.find((r) => r.name.toLowerCase() === clean(title).toLowerCase())?.id;
  for (const g of roadmaps) if (!roleByGoal.has(g.id)) { const same = byName(g.title); if (same) roleByGoal.set(g.id, same); else addRole(g, g.title); }
  if (!roles.length) roles.push({ id: 'r1', name: 'Main', priority: 1, targetMin: 600, floorMin: 0, kind: 'commitment' });
  const roleOf = (goalId) => roleByGoal.get(goalId) || null;

  const week = fromTemplates(templates, roleOf);
  const tasks = week.tasks.map((x, i) => ({ id: `gw${i + 1}`, title: x.title, roleId: x.roleId, minutes: x.minutes, rank: x.rank, deadline: null, status: 'todo' }));

  // Open tasks with a date keep it; overdue ones come in as debt.
  const quadrantRank = { 1: 1, 2: 2, 3: 3, 4: 'extra' };
  const open = (data.tasks || []).filter(live).filter((x) => x.status !== 'done' && clean(x.title));
  open.slice(0, 120).forEach((x, i) => {
    const due = [x.deadline, x.dueDate].find((d) => DATE.test(String(d || '').slice(0, 10)));
    const date = due ? String(due).slice(0, 10) : null;
    const roleId = roleOf(x.goalId) || roles.find((r) => `${x.tags || ''} ${x.title}`.toLowerCase().includes(r.name.toLowerCase()))?.id || roles[0].id;
    tasks.push({ id: `gt${i + 1}`, title: clean(x.title), roleId, minutes: Math.min(180, Math.max(15, (Number(x.estBlocks) || 1) * 50)), rank: quadrantRank[x.quadrant] ?? 2, deadline: date && date >= today ? date : null, status: 'todo', ...(date && date < today ? { debt: true } : {}) });
  });

  // Roadmap goals and their phases. Overlapping phases are trimmed, phases
  // under a weekly minimum are raised to it.
  const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const outGoals = roadmaps.filter((g) => roleOf(g.id)).slice(0, 12).map((g, i) => {
    const roleId = roleOf(g.id);
    const floor = roles.find((r) => r.id === roleId)?.floorMin || 0;
    const unit = clean(g.unit, 20);
    let lastEnd = '';
    const phases = (g.phases || []).filter(live).filter((p) => DATE.test(p.startDate || '') && DATE.test(p.endDate || '') && p.endDate >= p.startDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 8)
      .map((p, j) => {
        const start = lastEnd && p.startDate <= lastEnd ? nextDay(lastEnd) : p.startDate;
        if (start > p.endDate) return null;
        lastEnd = p.endDate;
        const hours = Number(p.weeklyTarget);
        const weeklyMin = Number.isFinite(hours) && hours > 0 && HOURS.test(p.weeklyUnit || 'giờ') ? Math.max(floor, Math.min(4800, Math.round(hours * 60))) : null;
        const expected = p.expectedValue != null && p.expectedValue !== '' ? `${p.expectedValue}${unit ? ` ${unit}` : ''}` : '';
        const ended = p.endDate < today;
        const actual = Number(p.actualValue);
        const retro = ended && p.actualValue !== '' && p.actualValue != null && Number.isFinite(actual) && Number.isFinite(Number(p.expectedValue))
          ? { verdict: actual >= Number(p.expectedValue) ? 'reached' : 'partly', at: p.endDate } : null;
        return { id: `g${i + 1}p${j + 1}`, title: clean(p.name, 60) || `Phase ${j + 1}`, start, end: p.endDate, weeklyMin, expect: clean(expected, 140), ...(retro ? { retro } : {}) };
      }).filter(Boolean);
    const measure = unit && g.targetValue != null ? `${g.startValue ?? ''}${g.startValue != null ? ' → ' : ''}${g.targetValue} ${unit}`.trim() : '';
    return { id: `g${i + 1}`, title: clean(g.title), roleId, measure, deadline: DATE.test(g.targetDate || '') ? g.targetDate : null, phases };
  });

  const sessions = (data.focusSessions || []).filter(live).filter((s) => Number(s.minutes) >= 1 && Date.parse(s.startedAt))
    .slice(-500).map((s, i) => ({ id: `gs${i + 1}`, roleId: roleOf(s.goalId), title: clean(s.label || s.title || ''), start: Date.parse(s.startedAt), end: Date.parse(s.endedAt) || Date.parse(s.startedAt) + Number(s.minutes) * 60000, minutes: Math.round(Number(s.minutes)) }));

  const { wake, sleep } = sleepOf(data.settings);
  const template = { roles, fixed: week.fixed, tasks, wake, sleep, goals: outGoals, log: sessions, history: [], done: {}, actuals: [], imported: { from: 'Greysteel Tasks', at: today } };
  return {
    template,
    summary: {
      roles: roles.length,
      fixed: week.fixed.length,
      blocks: week.tasks.length,
      tasks: open.length,
      goals: outGoals.length,
      phases: outGoals.reduce((s, g) => s + g.phases.length, 0),
      sessions: sessions.length,
      focusMin: sessions.reduce((s, x) => s + x.minutes, 0),
      skipped: week.skipped,
    },
  };
}
