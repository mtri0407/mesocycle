// The agent loop: the model reads the state and proposes through tools,
// tools.js checks every call. The model never touches the state directly.
import { TOOLS, runTool } from '../public/core/tools.js';
import { WEEK_TOOLS, WEEK_TOOL_NAMES, ACCEPT_TOOL, runWeekTool } from '../public/core/week-tools.js';
import { rebaseDay } from '../public/core/setup.js';
import { deadlineRadar } from '../public/core/radar.js';
import { applyEvent } from '../public/core/planner.js';

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
- When the plan has cutOptions, propose with them: option 1 as cut_ids,
  option 2 (if any) as alternative_cut_ids. They are already checked;
  do not invent your own cut list.

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

// chatFn(messages, tools) -> { text, toolCalls, message }. Injected so tests
// can use a scripted fake model and never spend credits.
// image: optional data URL (a timetable, a syllabus, a to-do list photo).
// onStep(step) is called after every tool call so the UI can show progress live.
// template and pending are only there for a real week: template unlocks the
// tools that reach past today, pending is a proposal waiting for an answer.
export async function runAgent({ state, userText, chatFn, history = [], image = null, onStep = () => {}, template = null, pending = null, weekday = 0, call = false }) {
  // The agent reads deadline risk from code; it never estimates it.
  const withRadar = (s) => (template ? { ...s, radar: deadlineRadar(template, s, { date: s.date, weekday }) } : s);
  state = withRadar(state);
  // Sending the plan up front saves one model round trip (a get_state call).
  const plan = runTool(state, 'get_state', {}).result;
  const title = (id) => state.queue.find((i) => i.id === id)?.title || id;
  const content = `${userText}

${state.date ? `Today is ${state.date} (weekday ${weekday}, 0=Sunday).\n` : ''}${call ? 'This is a voice call: your reply is read aloud, so no lists, at most 2 short sentences.\n' : ''}${pending ? `Pending proposal: ${pending.options.map((ids, i) => `option ${i + 1} moves to debt: ${ids.map(title).join(', ')}`).join('; ')}.\n` : ''}Current plan:
${JSON.stringify(plan)}`;
  const user = image
    ? { role: 'user', content: [{ type: 'text', text: content }, { type: 'image_url', image_url: { url: image } }] }
    : { role: 'user', content };
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, user];
  const trace = [];
  let proposal = null;
  let rejections = 0;
  const tools = [...TOOLS, ...(template ? WEEK_TOOLS : []), ...(pending ? [ACCEPT_TOOL] : [])];
  let changedWeek = false;
  const finish = (out) => (changedWeek ? { ...out, template } : out);

  for (let step = 0; step < MAX_STEPS; step++) {
    const out = await chatFn(messages, tools);
    if (!out.toolCalls.length) return finish({ reply: noDashes(out.text.trim()), state, proposal: proposal && { ...proposal, message: noDashes(proposal.message) }, trace });

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
        const ids = pending.options[(call.args?.option ?? 0) - 1];
        res = ids ? runTool(applyEvent(state, { type: 'cut', ids }), 'get_state', {}) : { ok: false, error: 'option must be 1 or 2.', state };
      } else res = runTool(state, call.name, call.args);
      const step = { tool: call.name, args: call.args ?? call.rawArgs, ok: res.ok, error: res.error };
      trace.push(step);
      onStep(step);
      if (res.ok) {
        state = res.state;
        if (res.proposal) proposal = res.proposal;
      } else {
        rejections++;
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(res.ok ? res.result : { error: res.error }),
      });
    }
    // A proposal ends the turn: its message is the answer, so one more model
    // call would only cost time.
    if (proposal) return finish({ reply: noDashes(proposal.message), state, proposal: { ...proposal, message: noDashes(proposal.message) }, trace });
    if (rejections >= MAX_REJECTIONS) {
      return finish({ reply: 'I could not find a valid change for that. Nothing was modified beyond what is shown.', state, proposal, trace, stopped: 'rejections' });
    }
  }
  return finish({ reply: 'That took too many steps. Here is the plan as it stands.', state, proposal, trace, stopped: 'steps' });
}
