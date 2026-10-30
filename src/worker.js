// Cloudflare Worker: serves the API. The web app itself comes from public/.
// API keys live only here (env), never in the browser.
// For now the browser keeps the plan state and sends it with each request;
// it moves to D1 storage before the live deploy.
import { chat } from './models.js';
import { runAgent } from './agent.js';
import { runTool } from './tools.js';
import { applyEvent } from './planner.js';
import { demoState } from './demo-state.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const view = (state) => runTool(state, 'get_state', {}).result;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
    if (request.method === 'POST' && !body) return json({ ok: false, error: 'Body must be JSON' }, 400);

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, provider: env.MODEL_PROVIDER || 'meta' });
      }

      if (url.pathname === '/api/model-check') {
        const out = await chat(env, {
          messages: [{ role: 'user', content: 'Reply with exactly: Mesocycle is alive.' }],
          maxTokens: 400, // reasoning models think first; 30 tokens ran out before any answer
        }, url.searchParams.get('provider'));
        return json({ ok: true, provider: out.provider, ms: out.ms, text: out.text });
      }

      // Fresh demo day. ?now=HH:MM sets the clock for demos.
      if (url.pathname === '/api/demo') {
        const [h, m] = (url.searchParams.get('now') || '07:00').split(':').map(Number);
        const state = demoState(h * 60 + m);
        return json({ ok: true, state, view: view(state) });
      }

      // Buttons on the Now card (done, more time, skip) run a tool directly, no model needed.
      if (url.pathname === '/api/tool' && body) {
        const res = runTool(body.state, body.name, body.args || {});
        return json({ ok: res.ok, error: res.error, state: res.state, view: view(res.state) });
      }

      // The user approved one option of a cut proposal.
      if (url.pathname === '/api/approve' && body) {
        const state = applyEvent(body.state, { type: 'cut', ids: body.ids });
        return json({ ok: true, state, view: view(state) });
      }

      // Free text (later: voice) goes to the agent.
      if (url.pathname === '/api/agent' && body) {
        const provider = body.provider || url.searchParams.get('provider');
        let modelMs = 0;
        const chatFn = async (messages, tools) => {
          const out = await chat(env, { messages, tools, maxTokens: 4000 }, provider);
          modelMs += out.ms;
          return out;
        };
        const out = await runAgent({ state: body.state, userText: String(body.text || ''), chatFn });
        return json({ ok: true, ...out, modelMs, view: view(out.state) });
      }

      return json({ ok: false, error: 'Not found' }, 404);
    } catch (err) {
      return json({ ok: false, error: String(err.message || err) }, 500);
    }
  },
};
