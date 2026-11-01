// The agent loop: the model reads the state and proposes through tools,
// tools.js checks every call. The model never touches the state directly.
import { TOOLS, runTool } from '../public/core/tools.js';
import { WEEK_TOOLS, WEEK_TOOL_NAMES, ACCEPT_TOOL, runWeekTool } from '../public/core/week-tools.js';
import { rebaseDay } from '../public/core/setup.js';
import { deadlineRadar } from '../public/core/radar.js';
import { applyEvent, replan } from '../public/core/planner.js';

export const SYSTEM_PROMPT = `You are Mesocycle, a planning agent. You protect the user's deadlines and
life floors, not the clock. Only fixed events (classes, exams, meetings,
sleep) have hard times; flexible work is an ordered queue that slides.

How you work:
- The current plan (same as get_state) comes with each user message.
  Never guess the schedule; after a change, read the plan the tool returns.
- Every change goes through tools. If a tool rejects it, read the reason
  and try another option (at most 2 retries), then explain.
- Small slips: let the queue slide and say it in one line.
- Ask the user ONLY when work must be cut, moved to another day, or a
  deadline or floor is at risk. Offer one default and one alternative.
- Missed work becomes debt; never push it into a specific future slot.
- When the user drops an item, mark it skipped with update_item, even if it
  is in doesNotFit, so it is kept as debt.
- A photo (timetable, message, to-do list): what happens today is
  add_fixed or add_item. If the tools below are offered, later dates use
  add_event and add_task. Without them, add only what happens today.
- add_item is for today only. If those tools are offered: work for
  another day or with a deadline is add_task; a set time on another day,
  or something that repeats every week, is add_event; a new long-term
  goal is add_goal. Work out dates from today's date.
- If a pending proposal comes with the message and the user clearly picks
  an option, call accept_proposal. Never choose for them.
- Say a deadline will be met only if a tool result says so.
- When the plan shows needsUser, first make every other change the user
  asked for, then call propose with one short message saying the day no
  longer fits. Two advisors prepare the options from cuts that code has
  already checked, so do not suggest what to cut.

Style: reply in the user's language. Short, calm, no blame, no guilt
words. At most 3 sentences plus the proposal. Never use em dashes or
en dashes; use commas or periods.

Boundaries: time planning only. No medical, mental health, nutrition or
training advice. If the user mentions feeling sick or stressed, only ask
how much time they have today.`;

// House style: no em or en dashes in anything the user reads.
const DASHES = new RegExp('\\s*[' + String.fromCharCode(0x2013, 0x2014) + ']\\s*', 'g');
export const noDashes = (s) => s.replace(DASHES, ', ');

const MAX_STEPS = 8;       // model calls per user message
const MAX_REJECTIONS = 3;  // first try + 2 retries

// What is said when the loop has to stop by itself. These come from code, so
// they are not in the person's language unless they are written here.
const STOPPED = {
  en: { rejections: 'I could not find a valid change for that. Nothing was modified beyond what is shown.', steps: 'That took too many steps. Here is the plan as it stands.', silent: 'Here is the plan as it stands.' },
  vi: { rejections: 'Mình chưa tìm được thay đổi nào hợp lệ. Kế hoạch chỉ đổi đúng những gì đang hiện.', steps: 'Việc này cần quá nhiều bước. Đây là kế hoạch hiện tại.', silent: 'Đây là kế hoạch hiện tại.' },
};

// chatFn(messages, tools) -> { text, toolCalls, message }. Injected so tests
// can use a scripted fake model and never spend credits.
// image: optional data URL (a timetable, a syllabus, a to-do list photo).
// onStep(step) is called after every tool call so the UI can show progress live.
// template and pending are only there for a real week: template unlocks the
// tools that reach past today, pending is a proposal waiting for an answer.
// councilFn(state) -> { options, agreed } from the two advisors, or null.
export async function runAgent({ state, userText, chatFn, history = [], image = null, onStep = () => {}, template = null, pending = null, weekday = 0, call = false, councilFn = null, lang = 'en' }) {
  const said = STOPPED[lang] || STOPPED.en;
  // The agent reads deadline risk from code; it never estimates it.
  const withRadar = (s) => (template ? { ...s, radar: deadlineRadar(template, s, { date: s.date, weekday }) } : s);
  state = withRadar(state);
  // Sending the plan up front saves one model round trip (a get_state call).
  const plan = runTool(state, 'get_state', {}).result;
  const title = (id) => state.queue.find((i) => i.id === id)?.title || id;
  // Which cuts to offer is the advisors' choice, so the model does not see them.
  const forModel = ({ cutOptions, ...rest }) => (councilFn ? rest : { ...rest, cutOptions });
  const content = `${userText}

${state.date ? `Today is ${state.date} (weekday ${weekday}, 0=Sunday).\n` : ''}${call ? 'This is a voice call: your reply is read aloud, so no lists, at most 2 short sentences.\n' : ''}${pending ? `Pending proposal: ${pending.options.map((o, i) => `option ${i + 1}${o.by ? ` (${o.by})` : ''} moves to debt: ${o.ids.map(title).join(', ')}`).join('; ')}.\n` : ''}Current plan:
${JSON.stringify(forModel(plan))}`;
  const user = image
    ? { role: 'user', content: [{ type: 'text', text: content }, { type: 'image_url', image_url: { url: image } }] }
    : { role: 'user', content };
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, user];
  const trace = [];
  let proposal = null;
  let rejections = 0;
  const tools = [...TOOLS, ...(template ? WEEK_TOOLS : []), ...(pending ? [ACCEPT_TOOL] : [])];
  let changedWeek = false;
  let changedDay = false;
  const finish = (out) => (changedWeek ? { ...out, template } : out);
  const adopt = (res) => {
    if (res.proposal) proposal = { ...res.proposal, options: res.proposal.options.map((o) => (o.ids ? o : { ids: o, by: 'code', why: '' })) };
  };

  // Started as soon as code knows a cut is needed, not when the model gets
  // round to asking, which saves a round trip of waiting. A later change to
  // the plan starts it again.
  let council = null;
  const planKey = (s) => JSON.stringify([s.now, s.fixed, s.queue.map((q) => [q.id, q.status, q.minutes])]);
  const startCouncil = () => {
    if (!councilFn) return Promise.resolve(null);
    const key = planKey(state);
    if (council?.key !== key) council = { key, run: Promise.resolve().then(() => councilFn(state)).catch(() => null) };
    return council.run;
  };

  // The advisors choose among cuts code has checked. If they fail, the cuts
  // code would suggest on its own go to the person instead.
  const askCouncil = async (message) => {
    if (typeof message !== 'string' || !message.trim()) return { ok: false, error: 'message is required.', state };
    const picked = await startCouncil();
    if (picked) return { ok: true, state, result: { proposed: true }, proposal: { message: message.trim(), ...picked } };
    const [first, second] = runTool(state, 'get_state', {}).result.cutOptions.map((o) => o.map((x) => x.id));
    if (!first) return { ok: false, error: 'Nothing needs cutting: the plan does not show needsUser.', state };
    return runTool(state, 'propose', { message, cut_ids: first, alternative_cut_ids: second || [] });
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const out = await chatFn(messages, tools);
    if (!out.toolCalls.length) {
      // The day stopped fitting and the model did not ask. Rules decide when to
      // ask, so code asks: nothing may slip out of the day unmentioned.
      if (councilFn && changedDay && !proposal && replan(state).needsUser) {
        const res = await askCouncil(out.text.trim() || 'The day no longer fits.');
        if (res.ok) {
          adopt(res);
          trace.push({ tool: 'propose', ok: true });
          return finish({ reply: noDashes(proposal.message), state, proposal: { ...proposal, message: noDashes(proposal.message) }, trace });
        }
      }
      return finish({ reply: noDashes(out.text.trim()) || said.silent, state, proposal: proposal && { ...proposal, message: noDashes(proposal.message) }, trace });
    }

    messages.push({ role: 'assistant', content: out.message?.content ?? '', tool_calls: out.message?.tool_calls });
    for (const call of out.toolCalls) {
      let res;
      if (template && WEEK_TOOL_NAMES.has(call.name)) {
        res = { ...runWeekTool(template, call.name, call.args, { today: state.date }), state };
        if (res.ok) {
          template = res.template;
          changedWeek = true;
          state = withRadar(rebaseDay(template, state, { weekday }));
          res = { ...res, state, result: runTool(state, 'get_state', {}).result };
        }
      } else if (pending && call.name === 'accept_proposal') {
        const ids = pending.options[(call.args?.option ?? 0) - 1]?.ids;
        res = ids ? runTool(applyEvent(state, { type: 'cut', ids }), 'get_state', {}) : { ok: false, error: 'option must be 1 or 2.', state };
      } else if (call.name === 'propose' && (councilFn || !call.args?.cut_ids?.length)) {
        res = await askCouncil(call.args?.message);
      } else res = runTool(state, call.name, call.args);
      const step = { tool: call.name, args: call.args ?? call.rawArgs, ok: res.ok, error: res.error };
      trace.push(step);
      onStep({ ...step, state: res.state });
      if (res.ok) {
        state = res.state;
        adopt(res);
        if (call.name !== 'get_state' && call.name !== 'propose') changedDay = true;
      } else {
        rejections++;
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(res.ok ? (res.result?.cutOptions ? forModel(res.result) : res.result) : { error: res.error }),
      });
    }
    if (councilFn && changedDay && !proposal && replan(state).needsUser) startCouncil();
    // A proposal ends the turn: its message is the answer, so one more model
    // call would only cost time.
    if (proposal) return finish({ reply: noDashes(proposal.message), state, proposal: { ...proposal, message: noDashes(proposal.message) }, trace });
    if (rejections >= MAX_REJECTIONS) {
      return finish({ reply: said.rejections, state, proposal, trace, stopped: 'rejections' });
    }
  }
  return finish({ reply: said.steps, state, proposal, trace, stopped: 'steps' });
}
