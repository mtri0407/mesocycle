// Sign in with Google, and one saved plan per person.
// The browser gets a Google ID token (a signed JWT) from Google's button.
// We verify its signature with Google's public keys, then issue our own
// random session id, kept in KV for 30 days. We never see a password.

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const SESSION_TTL = 30 * 86400;
const MAX_DATA = 300_000; // bytes of saved plan per person

let certCache = { keys: null, until: 0 };
async function googleKeys() {
  if (certCache.keys && Date.now() < certCache.until) return certCache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('Could not load Google sign-in keys');
  const { keys } = await res.json();
  certCache = { keys, until: Date.now() + 3600_000 };
  return keys;
}

const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

// Returns the verified claims of a Google ID token, or throws.
export async function verifyGoogleToken(token, clientId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed sign-in token');
  const [h, p, sig] = parts;
  const header = b64urlJson(h);
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw new Error('Unknown sign-in key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('Bad sign-in signature');
  const claims = b64urlJson(p);
  if (!ISSUERS.includes(claims.iss)) throw new Error('Wrong token issuer');
  if (claims.aud !== clientId) throw new Error('Token is for another app');
  if (claims.exp * 1000 < Date.now()) throw new Error('Sign-in expired, try again');
  return claims;
}

export async function createSession(env, claims) {
  const sid = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const user = { sub: claims.sub, email: claims.email, name: claims.name || claims.email };
  await env.FEEDBACK.put(`sess:${sid}`, JSON.stringify(user), { expirationTtl: SESSION_TTL });
  return { sid, user };
}

export async function sessionUser(request, env) {
  const sid = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^[0-9a-f]{64}$/.test(sid)) return null;
  const raw = await env.FEEDBACK.get(`sess:${sid}`);
  return raw ? { ...JSON.parse(raw), sid } : null;
}

export async function loadData(env, user) {
  const raw = await env.FEEDBACK.get(`user:${user.sub}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveData(env, user, data) {
  const text = JSON.stringify({ ...data, savedAt: new Date().toISOString() });
  if (text.length > MAX_DATA) throw new Error('Plan too large to save');
  await env.FEEDBACK.put(`user:${user.sub}`, text);
}
