// Reminders: the times of today's blocks, sent only when they change.
import { $, store } from '/js/dom.js';

let app, vapidPublic = null, remindKey = '';
export const setVapidKey = (key) => { vapidPublic = key; };
const remindOn = () => store.get('meso-push') === '1';
export function renderRemind() {
  const { mode, template, t } = app;
  const btn = $('remind');
  btn.hidden = !vapidPublic || !('PushManager' in window) || mode !== 'real' || !!template?.sample;
  btn.textContent = remindOn() ? t('remindOff') : t('remindOn');
}
const keyBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export async function syncReminders(force = false) {
  const { mode, template, view, api, dayMin, logicalNow } = app;
  if (!remindOn() || mode !== 'real' || template?.sample || !view) return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (!sub) return;
    const midnight = new Date(logicalNow().d); midnight.setHours(0, 0, 0, 0);
    const times = [...view.queue, ...view.fixed].map((x) => midnight.getTime() + dayMin(x.start) * 60000).filter((at) => at > Date.now()).sort((a, b) => a - b);
    const key = JSON.stringify(times);
    if (key === remindKey && !force) return;
    remindKey = key;
    await api('/api/reminders', { endpoint: sub.endpoint, times });
  } catch { /* reminders are optional */ }
}
async function toggle() {
  const { api, t } = app;
  const note = $('remind-status');
  try {
    const reg = await navigator.serviceWorker.ready;
    if (remindOn()) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('/api/reminders', { off: true, endpoint: sub.endpoint }); await sub.unsubscribe(); }
      store.set('meso-push', '');
      note.textContent = '';
    } else {
      if (await Notification.requestPermission() !== 'granted') { note.textContent = t('remindDenied'); return; }
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublic) });
      store.set('meso-push', '1');
      await syncReminders(true);
      note.textContent = t('remindSet');
    }
    renderRemind();
  } catch (e) { note.textContent = e.message; }
}
export function setupReminders(context) { app = context; $('remind').onclick = toggle; }
