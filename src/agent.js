// The agent loop: the model reads the state and proposes through tools,
// tools.js checks every call. The model never touches the state directly.
import { TOOLS, runTool } from './tools.js';

export const SYSTEM_PROMPT = `You are Mesocycle, a planning agent. You protect the user's deadlines and
life floors, not the clock. Only fixed events (classes, exams, meetings,
sleep) have hard times; flexible work is an ordered queue that slides.

How you work:
- Always call get_state first. Never guess the schedule.
- Every change goes through tools. If a tool rejects it, read the reason
  and try another option (at most 2 retries), then explain.
- Small slips: let the queue slide and say it in one line.
- Ask the user ONLY when work must be cut, moved to another day, or a
  deadline or floor is at risk. Offer one default and one alternative.
- Missed work becomes debt; never push it into a specific future slot.

Style: reply in the user's language. Short, calm, no blame, no guilt
words. At most 3 sentences plus the proposal.

Boundaries: time planning only. No medical, mental health, nutrition or
training advice. If the user mentions feeling sick or stressed, only ask
how much time they have today.`;

const MAX_STEPS = 8;       // model calls per user message
const MAX_REJECTIONS = 3;  // first try + 2 retries

// chatFn(messages, tools) -> { text, toolCalls, message }. Injected so tests
// can use a scripted fake model and never spend credits.
export async function runAgent({ state, userText, chatFn, history = [] }) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: userText }];
  const trace = [];
  let proposal = null;
  let rejections = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const out = await chatFn(messages, TOOLS);
    if (!out.toolCalls.length) return { reply: out.text.trim(), state, proposal, trace };

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
