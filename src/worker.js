// Cloudflare Worker: serves the API. The web app itself comes from public/.
// API keys live only here (env), never in the browser.
import { chat } from './models.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, provider: env.MODEL_PROVIDER || 'meta' });
    }

    // Day 1 smoke test: one short round trip to the model.
    // /api/model-check?provider=open tries Muse Spark Open instead.
    if (url.pathname === '/api/model-check') {
      try {
        const out = await chat(env, {
          messages: [{ role: 'user', content: 'Reply with exactly: Mesocycle is alive.' }],
          maxTokens: 30,
        }, url.searchParams.get('provider'));
        return json({ ok: true, provider: out.provider, ms: out.ms, text: out.text });
      } catch (err) {
        return json({ ok: false, error: String(err.message || err) }, 500);
      }
    }

    return json({ ok: false, error: 'Not found' }, 404);
  },
};
