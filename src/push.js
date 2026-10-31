// Reminders when the app is closed. The browser gives us a push address and
// the times of today's blocks; a cron job wakes it at those times. The push
// carries no content, so task names never pass through a push service. The
// service worker shows a fixed sentence.
const WINDOW_MS = 5 * 60_000; // how often the cron job runs
const TTL_SECONDS = 2 * 86400; // today's times are useless after that
const MAX_TIMES = 24;
const HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64json = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

// Only real push services: otherwise anyone could make our cron call any URL.
export function isPushEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && HOSTS.test(u.hostname);
  } catch { return false; }
}

async function keyFor(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return `push:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// Splits times into those due in this cron window and those still ahead.
export function splitDue(times, now) {
  return { due: times.filter((t) => t <= now && t > now - WINDOW_MS), ahead: times.filter((t) => t > now) };
}

export async function saveReminders(env, { endpoint, times }) {
  if (!isPushEndpoint(endpoint)) throw new Error('Not a push service');
  const list = (Array.isArray(times) ? times : []).filter((t) => Number.isFinite(t)).slice(0, MAX_TIMES);
  await env.FEEDBACK.put(await keyFor(endpoint), JSON.stringify({ endpoint, times: list }), { expirationTtl: TTL_SECONDS });
}

export async function deleteReminders(env, endpoint) {
  await env.FEEDBACK.delete(await keyFor(endpoint));
}

// A short signed note that proves the push comes from this app (VAPID).
export async function vapidHeader(env, endpoint, now) {
  const head = b64json({ typ: 'JWT', alg: 'ES256' });
  const body = b64json({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: 'mailto:minhtriphamnguyen69@gmail.com' });
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

export async function sendDue(env, now) {
  if (!env.VAPID_JWK) return;
  const { keys } = await env.FEEDBACK.list({ prefix: 'push:' });
  for (const { name } of keys) {
    const raw = await env.FEEDBACK.get(name);
    if (!raw) continue;
    const { endpoint, times } = JSON.parse(raw);
    const { due, ahead } = splitDue(times, now);
    if (due.length) {
      const res = await fetch(endpoint, { method: 'POST', headers: { TTL: '600', Urgency: 'high', Authorization: await vapidHeader(env, endpoint, now) } });
      if (res.status === 404 || res.status === 410) { await env.FEEDBACK.delete(name); continue; } // the person turned it off
    }
    if (ahead.length !== times.length) {
      if (ahead.length) await env.FEEDBACK.put(name, JSON.stringify({ endpoint, times: ahead }), { expirationTtl: TTL_SECONDS });
      else await env.FEEDBACK.delete(name);
    }
  }
}
