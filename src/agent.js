// The agent loop: the model reads the state and proposes through tools,
// tools.js checks every call. The model never touches the state directly.
import { TOOLS, runTool } from './tools.js';

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
- A photo (timetable, syllabus, to-do list): add only what happens TODAY.
  Classes and meetings with a time are add_fixed; tasks are add_item.
- When proposing cuts, check budgetMin and usedMin in the plan so the
  first proposal already fits.

Style: reply in the user's language. Short, calm, no blame, no guilt
words. At most 3 sentences plus the proposal. Never use em dashes or
en dashes; use commas or periods.

Boundaries: time planning only. No medical, mental health, nutrition or
training advice. If the user mentions feeling sick or stressed, only ask
how much time they have today.`;

// House style: no em or en dashes in anything the user reads.
const noDashes = (s) => s.replace(/s*[–—]s*/g, ', ');

const MAX_STEPS = 8;       // model calls per user message
const MAX_REJECTIONS = 3;  // first try + 2 retries

// chatFn(messages, tools) -> { text, toolCalls, message }. Injected so tests
// can use a scripted fake model and never spend credits.
// image: optional data URL (a timetable, a syllabus, a to-do list photo).
export async function runAgent({ state, userText, chatFn, history = [], image = null }) {
  // Sending the plan up front saves one model round trip (a get_state call).
  const plan = runTool(state, 'get_state', {}).result;
  const content = `${userText}

Current plan:
${JSON.stringify(plan)}`;
  const user = image
    ? { role: 'user', content: [{ type: 'text', text: content }, { type: 'image_url', image_url: { url: image } }] }
    : { role: 'user', content };
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, user];
  const trace = [];
  let proposal = null;
  let rejections = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const out = await chatFn(messages, TOOLS);
    if (!out.toolCalls.length) return { reply: noDashes(out.text.trim()), state, proposal: proposal && { ...proposal, message: noDashes(proposal.message) }, trace };

    messages.push({ role: 'assistant', content: out.message?.content ?? '', tool_calls: out.message?.tool_calls });
    for (const call of out.toolCalls) {
      const res = runTool(state, call.name, call.args);
      trace.push({ tool: call.name, args: call.args ?? call.rawArgs, ok: res.ok, error: res.error });
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
    if (rejections >= MAX_REJECTIONS) {
      return { reply: 'I could not find a valid change for that. Nothing was modified beyond what is shown.', state, proposal, trace, stopped: 'rejections' };
    }
  }
  return { reply: 'That took too many steps. Here is the plan as it stands.', state, proposal, trace, stopped: 'steps' };
}
