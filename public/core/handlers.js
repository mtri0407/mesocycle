// Everything that needs no AI and no account. This same code runs in the
// browser, so pressing a button is instant, works offline and sends nothing.
// Each handler is pure: data in, data out.
import { runTool } from './tools.js';
import { applyEvent, replan, toHHMM } from './planner.js';
import { demoState } from './demo-state.js';
import { buildDay, forecastWeek, rollover, rebaseDay, adoptNext, goalPace, weekReview, checkTemplate, pullNext } from './setup.js';
import { sampleWeek } from './sample.js';

export const view = (state) => runTool(state, 'get_state', {}).result;

export const handlers = {
  // Fresh demo day. now=HH:MM sets the clock for demos.
  '/api/demo': ({ now = '07:00', lang }) => {
    const [h, m] = now.split(':').map(Number);
    const state = demoState(h * 60 + m, lang === 'vi' ? 'vi' : 'en');
    return { ok: true, state, view: view(state) };
  },

  // Buttons on the Now card (done, more time, skip) run a tool directly.
  '/api/tool': ({ state, name, args }) => {
    const res = runTool(state, name, args || {});
    return { ok: res.ok, error: res.error, state: res.state, view: view(res.state) };
  },

  // The user approved one option of a cut proposal.
  '/api/approve': ({ state, ids }) => {
    const next = applyEvent(state, { type: 'cut', ids });
    return { ok: true, state: next, view: view(next) };
  },

  // A made-up week for new visitors, clearly labelled in the app.
  '/api/sample': (body) => {
    const template = sampleWeek(body);
    const state = buildDay(template, { date: body.date, weekday: body.weekday, now: 9 * 60 });
    return { ok: true, template, state, view: view(state) };
  },

  // Today's plan from a saved weekly template (a new day, or a new week).
  '/api/day': ({ template, state, date, weekday, now }) => {
    const out = rollover(template, state || null, { date, weekday, now });
    return { ok: true, ...out, view: view(out.state) };
  },

  // The user edited the plan by hand: check it, then update today in place.
  '/api/edit': ({ template, next, state, weekday, lang }) => {
    const edited = next ? adoptNext(template, next) : template;
    const errors = checkTemplate(edited, lang);
    if (errors.length) return { ok: false, error: errors[0], errors };
    const updated = rebaseDay(edited, state, { weekday });
    return { ok: true, template: edited, state: updated, view: view(updated) };
  },

  // Finished early: one more block from the backlog.
  '/api/more': ({ template, state }) => {
    const next = pullNext(template, state);
    return { ok: true, state: next, view: view(next) };
  },

  // Rest-of-week forecast: where today's debt and open work would land.
  // Demo mode has no weekly template, so today's debt is the backlog.
  '/api/week': ({ state, template, weekday, date }) => {
    const placed = replan(state).placed.map((p) => p.id);
    const week = template || {
      roles: state.roles,
      fixed: [],
      tasks: state.queue.filter((q) => q.status === 'skipped' || q.status === 'cut' || (q.status === 'todo' && !placed.includes(q.id)))
        .map((q) => ({ ...q, status: 'todo' })),
      wake: toHHMM(state.settings.wake),
      sleep: toHHMM(state.settings.sleep),
    };
    const done = state.queue.filter((q) => q.status === 'done').map((q) => q.id);
    return {
      ok: true,
      ...forecastWeek(week, { weekday, date: template ? date : '', exclude: [...placed, ...done] }),
      ...(template ? { review: weekReview(template), goals: goalPace(template, { weekday, date }) } : {}),
    };
  },
};
