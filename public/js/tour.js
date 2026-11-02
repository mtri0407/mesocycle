// A short tour: a dim layer with a hole over each part, and one sentence.
// It only starts when asked, so it never stands between a person and the app.
import { $ } from '/js/dom.js';

let app, steps = [], at = 0;
const STEPS = ['#now-card', '#ask', '#call', '#tl-card', '[data-tab=week]', '[data-tab=goals]'];
const t = (k) => app.t(k);
const shown = (el) => !!el && el.getClientRects().length > 0;

function place() {
  const el = document.querySelector(steps[at]);
  if (!shown(el)) { next(1); return; }
  const r = el.getBoundingClientRect();
  const pad = 6;
  const hole = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: Math.min(r.height + pad * 2, innerHeight - 24) };
  const below = hole.top + hole.height + 12;
  const cardTop = below + 190 < innerHeight ? below : Math.max(12, hole.top - 202);
  const cardLeft = Math.min(Math.max(12, hole.left), innerWidth - Math.min(340, innerWidth - 24) - 12);
  const text = t('tour')[STEPS.indexOf(steps[at])];
  const last = at === steps.length - 1;
  $('tour').innerHTML = `<div class="tour-hole" style="top:${hole.top}px;left:${hole.left}px;width:${hole.width}px;height:${hole.height}px"></div>
    <div class="tour-card" role="dialog" aria-live="polite" style="top:${cardTop}px;left:${cardLeft}px">
      <p class="hint">${t('tourOf')(at + 1, steps.length)}</p><p>${text}</p>
      <div class="row">${at ? `<button class="small" id="tour-back">${t('tourBack')}</button>` : ''}<button class="primary small" id="tour-next">${last ? t('tourDone') : t('tourNext')}</button><span class="grow"></span><button class="small linkish" id="tour-skip">${t('tourSkip')}</button></div>
    </div>`;
  $('tour-next').onclick = () => next(1);
  if (at) $('tour-back').onclick = () => next(-1);
  $('tour-skip').onclick = endTour;
  $('tour-next').focus();
}

function show() {
  const el = document.querySelector(steps[at]);
  if (!shown(el)) { next(1); return; }
  el.scrollIntoView({ block: 'center' });
  requestAnimationFrame(place);
}

function next(step) {
  at += step;
  if (at < 0) at = 0;
  if (at >= steps.length) { endTour(); return; }
  show();
}

function onKey(e) {
  if (e.key === 'Escape') endTour();
  if (e.key === 'ArrowRight') next(1);
  if (e.key === 'ArrowLeft') next(-1);
}

export function endTour() {
  $('tour').hidden = true;
  $('tour').innerHTML = '';
  removeEventListener('resize', place);
  removeEventListener('keydown', onKey);
}

export function startTour() {
  app.showTab('today');
  steps = STEPS.filter((s) => shown(document.querySelector(s)));
  at = 0;
  $('tour').hidden = false;
  addEventListener('resize', place);
  addEventListener('keydown', onKey);
  show();
}

export function setupTour(context) { app = context; }
