// Cloudflare Worker: serves the API. The web app itself comes from public/.
// API keys live only here (env), never in the browser.
// For now the browser keeps the plan state and sends it with each request;
// it moves to D1 storage before the live deploy.
import { chat, transcribe } from './models.js';
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      // Voice check-in: the browser sends a WAV clip, we return the text.
      if (url.pathname === '/api/transcribe' && request.method === 'POST') {
        const wav = await request.arrayBuffer();
        if (wav.byteLength > 32e6) return json({ ok: false, error: 'Recording too long' }, 413);
        return json({ ok: true, ...(await transcribe(env, wav)) });
      }

      const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
      if (request.method === 'POST' && !body) return json({ ok: false, error: 'Body must be JSON' }, 400);

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
        const state = demoState(h * 60 + m, url.searchParams.get('lang') === 'vi' ? 'vi' : 'en');
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
        // Photos always go to Muse Spark (image understanding).
        const provider = body.image ? 'meta' : body.provider || url.searchParams.get('provider');
        if (body.image && !/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(body.image)) return json({ ok: false, error: 'Image must be a JPEG, PNG, WebP or GIF data URL' }, 400);
        let modelMs = 0;
        const chatFn = async (messages, tools) => {
          const out = await chat(env, { messages, tools, maxTokens: 4000 }, provider);
          modelMs += out.ms;
          return out;
        };
        const args = { state: body.state, userText: String(body.text || ''), chatFn, image: body.image || null };
        if (!body.stream) {
          const out = await runAgent(args);
          return json({ ok: true, ...out, modelMs, view: view(out.state) });
        }
        // Streamed: one JSON line per tool call as it happens, then the result.
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const send = (obj) => writer.write(new TextEncoder().encode(JSON.stringify(obj) + '\n'));
        ctx.waitUntil((async () => {
          try {
            const out = await runAgent({ ...args, onStep: (step) => send({ type: 'step', ...step }) });
            await send({ type: 'done', ok: true, ...out, modelMs, view: view(out.state) });
          } catch (err) {
            await send({ type: 'done', ok: false, error: String(err.message || err) });
          }
          await writer.close();
        })());
        return new Response(readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
      }

      // Feedback from testers: short text, stored in KV, never shown publicly.
      if (url.pathname === '/api/feedback' && body) {
        const text = String(body.text || '').trim().slice(0, 2000);
        if (!text) return json({ ok: false, error: 'Empty feedback' }, 400);
        const key = `${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}`;
        await env.FEEDBACK.put(key, JSON.stringify({ text, lang: body.lang || '', rating: body.rating ?? null }));
        return json({ ok: true });
      }

      return json({ ok: false, error: 'Not found' }, 404);
    } catch (err) {
      return json({ ok: false, error: String(err.message || err) }, 500);
    }
  },
};
