// Talking to Mesocycle: the microphone button, and the hands-free call.
import { $ } from '/js/dom.js';
import { micFrames, beep, toWav } from '/js/audio.js';

// Voice check-in: record, convert to 16 kHz mono WAV (what the
// transcription API accepts), transcribe, then send the text to the agent.
let app, recorder = null, micTarget = 'say';
const t = (k) => app.t(k);
async function startMic(target) {
  const { askConsent, send, errMsg, visitorId } = app;
  if (recorder) { recorder.stop(); return; }
  if (!(await askConsent())) return;
  micTarget = target;
  const btn = target === 'setup' ? $('setup-mic') : $('mic');
  const status = target === 'setup' ? $('setup-status') : $('status');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { status.textContent = t('noMic'); return; }
  const chunks = [];
  const live = startLive(stream, status);
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    recorder = null;
    btn.textContent = t('speak');
    status.textContent = t('transcribing');
    const heard = await live.finish();
    stream.getTracks().forEach((tr) => tr.stop());
    if (heard) {
      status.textContent = '';
      if (target === 'setup') $('setup-text').value = ($('setup-text').value + ' ' + heard).trim();
      else { $('say').value = heard; send(); }
      return;
    }
    try {
      const wav = await toWav(new Blob(chunks));
      const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Visitor': visitorId }, body: wav });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(errMsg(data));
      if (!data.text) { status.textContent = t('notCaught'); return; }
      if (target === 'setup') { $('setup-text').value = ($('setup-text').value + ' ' + data.text).trim(); status.textContent = ''; }
      else { $('say').value = data.text; send(); }
    } catch (e) { status.textContent = e.message; }
  };
  recorder.start();
  btn.textContent = t('stop');
  status.textContent = t('listening');
}

const voiceUrl = (q = '') => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice?v=${app.visitorId}${q}`;

// Shows words as they come. finish() resolves with the text, or '' if live
// voice did not work, in which case the recording is transcribed the old
// way and nothing is lost.
function startLive(stream, status) {
  let finals = '', partial = '', failed = false, closed;
  const whenClosed = new Promise((r) => { closed = r; });
  let ws, stopMic;
  const early = []; // the connection takes about a second; the first words wait for it
  try {
    ws = new WebSocket(voiceUrl());
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => early.splice(0).forEach((b) => ws.send(b));
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.type === 'error') { failed = true; return; }
      if (m.type !== 'transcript') return;
      if (m.final) { finals = `${finals} ${m.text}`.trim(); partial = ''; } else partial = m.text;
      status.textContent = `${finals} ${partial}`.trim() || t('listening');
    };
    ws.onerror = () => { failed = true; };
    ws.onclose = () => closed();
    stopMic = micFrames(stream, (frame) => {
      if (ws.readyState === 0) early.push(frame);
      else if (ws.readyState === 1) ws.send(frame);
    });
  } catch { failed = true; closed(); }
  return {
    async finish() {
      stopMic?.();
      if (ws?.readyState === 1) ws.send('{"type":"endStream"}'); else closed();
      await Promise.race([whenClosed, new Promise((r) => setTimeout(r, 5000))]);
      try { ws?.close(); } catch {}
      return failed ? '' : `${finals} ${partial}`.trim();
    },
  };
}

// AI call: the model hears when a sentence ends, the agent acts through
// the same checked tools, and the device reads the answer aloud. Meta has
// no speech output yet, so the voice is the browser's own. While the AI
// works or talks, silence is sent instead of the mic, so it never hears
// itself; the stream must keep flowing or the server closes it.
let callNow = null;
const SILENCE = new Int16Array(2048).buffer;
// Words from this plan, so names are heard the way they are written.
function planWords() {
  const { view, state, template } = app;
  return [...new Set([...view.roles.map((r) => r.name), ...state.queue.map((q) => q.title), ...(template?.goals || []).map((g) => g.title)])].slice(0, 40);
}
const VI_CHARS = /[đăâêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
function callPhase(p) {
  if (!callNow) return;
  callNow.phase = p;
  $('call-phase').textContent = t(`call_${p}`);
  $('call-stop').hidden = p !== 'speaking';
}
// Browsers load their voices late: asked too early, the list is empty.
const voicesReady = () => new Promise((done) => {
  const synth = window.speechSynthesis;
  if (!synth || synth.getVoices().length) { done(); return; }
  synth.addEventListener('voiceschanged', done, { once: true });
  setTimeout(done, 2000);
});
async function speakOut(text, call) {
  await voicesReady();
  if (callNow !== call) return undefined; // ended while the voices were loading
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const want = VI_CHARS.test(text) ? 'vi' : 'en';
    const voice = synth?.getVoices().find((v) => v.lang.toLowerCase().startsWith(want));
    if (!voice) { $('call-note').textContent = t('noVoice'); setTimeout(resolve, Math.min(5000, 1000 + text.length * 40)); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    const guard = setTimeout(resolve, 4000 + text.length * 150); // some browsers never fire onend
    u.onend = u.onerror = () => { clearTimeout(guard); resolve(); };
    synth.cancel();
    synth.speak(u);
  });
}
function spokenAnswer(done) {
  const { state } = app;
  const title = (id) => (state.queue.find((q) => q.id === id) || {}).title || id;
  const p = done.proposal;
  // Spoken: the reason, not seven task names. The names are on the screen.
  const name = (o) => (t('guardian')[o.by] || '').replace(/^\S+\s/, '');
  const options = p ? p.options.map((o, i) => `${t('optionN')(i + 1)}${name(o) ? `, ${name(o)}` : ''}: ${o.why || o.ids.map(title).slice(0, 3).join(', ')}.`).join(' ') : '';
  return `${done.reply || p?.message || ''} ${options}${p ? ` ${t('whichOne')}` : ''}`.trim();
}
async function callTurn(text) {
  const me = callNow;
  callPhase('thinking');
  $('call-live').textContent = text;
  $('call-reply').textContent = '';
  const done = await app.send(text, null, { call: true });
  if (callNow !== me) return;
  const line = done ? spokenAnswer(done) : $('status').textContent || t('errNet');
  $('call-reply').textContent = line;
  callPhase('speaking');
  await speakOut(line, me);
  if (callNow !== me) return;
  me.heard = Date.now();
  callPhase('listening');
}
// When voice cannot run, the plain way is always there.
function typeInstead(message) {
  $('status').textContent = message;
  $('say').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('say').focus();
}
async function startCall() {
  const { askConsent, showTab, count } = app;
  if (callNow || $('call').disabled) return;
  $('call').disabled = true; // the permission prompt can take a while
  // Browsers only allow speech that starts from a tap, so it starts here.
  window.speechSynthesis?.getVoices();
  window.speechSynthesis?.speak(new SpeechSynthesisUtterance(''));
  let stream = null;
  if (await askConsent()) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { typeInstead(t('noMic')); }
  }
  $('call').disabled = false;
  if (!stream) return;
  showTab('today');
  count('call');
  $('call').hidden = true;
  const ws = new WebSocket(voiceUrl('&call=1'));
  ws.binaryType = 'arraybuffer';
  const me = { ws, stream, phase: 'speaking', stopMic: null, heard: Date.now(), lock: null };
  callNow = me;
  navigator.wakeLock?.request('screen').then((l) => { if (callNow === me) me.lock = l; else l.release(); }).catch(() => {});
  ws.onopen = () => ws.send(JSON.stringify({ keywords: planWords() }));
  $('call-box').hidden = false;
  $('call-live').textContent = ''; $('call-reply').textContent = ''; $('call-note').textContent = '';
  callPhase('speaking');
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (callNow !== me || me.phase !== 'listening') return;
    if (m.type === 'transcript' && m.text) { $('call-live').textContent = m.text; me.heard = Date.now(); }
    if (m.type === 'turn' && m.text.trim()) { beep(); callTurn(m.text.trim()); }
  };
  // Only this call: the socket of an older one can close late.
  ws.onclose = () => { if (callNow === me) { endCall(); typeInstead(t('callLost')); } };
  me.stopMic = micFrames(stream, (frame) => {
    if (ws.readyState === 1) ws.send(me.phase === 'listening' ? frame : SILENCE);
  });
  await speakOut(t('callHello'), me);
  if (callNow !== me) return; // ended during the greeting
  callPhase('listening');
  // A forgotten call must not keep the microphone open.
  me.idle = setInterval(() => {
    if (callNow === me && me.phase === 'listening' && Date.now() - me.heard > 90000) endCall();
  }, 5000);
}
function endCall() {
  if (!callNow) return;
  const { ws, stream, stopMic, lock, idle } = callNow;
  callNow = null;
  clearInterval(idle);
  lock?.release().catch(() => {});
  $('call').hidden = false;
  stopMic?.();
  stream.getTracks().forEach((tr) => tr.stop());
  try { ws.close(); } catch {}
  window.speechSynthesis?.cancel();
  $('call-box').hidden = true;
}

export const inCall = () => !!callNow;
export function micLabels() {
  $('setup-mic').textContent = recorder && micTarget === 'setup' ? t('stop') : t('speak');
  $('mic').textContent = recorder && micTarget === 'say' ? t('stop') : t('speak');
}
export function setupVoice(context) {
  app = context;
  $('mic').onclick = () => startMic('say');
  $('setup-mic').onclick = () => startMic('setup');
  $('call').onclick = startCall;
  $('call-end').onclick = endCall;
  $('call-stop').onclick = () => window.speechSynthesis?.cancel();
}
