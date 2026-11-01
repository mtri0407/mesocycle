// End-to-end checks in a real browser. Needs no API key: nothing here calls a
// model unless --ai is given.
//   npx wrangler dev --port 8799        (in another terminal)
//   node scripts/e2e.mjs                against http://localhost:8799
//   BASE=https://... node scripts/e2e.mjs --ai
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8799';
const AI = process.argv.includes('--ai');
const browser = await chromium.launch();
const failures = [];
let checks = 0;

async function open({ time = '2026-11-03T10:00:00+07:00', viewport = { width: 390, height: 844 }, sw = 'block', seed = null, before = null } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'Asia/Ho_Chi_Minh', serviceWorkers: sw });
  if (seed) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } }, seed);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(time));
  page.apiCalls = [];
  page.errors = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) page.apiCalls.push(new URL(r.url()).pathname); });
  page.on('pageerror', (e) => page.errors.push(e.message));
  // A real week says good morning through the AI; these checks never call a model.
  await page.route('**/api/checkin', (r) => r.fulfill({ json: { ok: true, text: '' } }));
  if (before) await before(page);
  await page.goto(BASE);
  await page.waitForSelector('#now-card .now-title');
  return page;
}

async function check(name, fn) {
  checks++;
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${String(e.message).split('\n')[0].slice(0, 160)}`);
  }
}
const SID = 'a'.repeat(64);
const CONSENT = { 'meso-consent': '2026-11-01' };
// A real week, not labelled as a sample, as saved by a person.
async function realWeek() {
  const p = await open();
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  const t = await local(p, 'meso-template');
  const s = await local(p, 'meso-state');
  await p.context().close();
  delete t.sample;
  return { t, s, seed: { 'meso-template': JSON.stringify(t), 'meso-state': JSON.stringify(s), 'meso-mode': 'real', ...CONSENT } };
}
// One finished turn of the agent, as the Worker streams it.
const agentDone = (over = {}) => JSON.stringify({ type: 'done', ok: true, reply: 'ok', trace: [], ...over }) + '\n';
const answer = (r, over) => r.fulfill({ status: 200, contentType: 'application/x-ndjson', body: agentDone(over) }).catch(() => {});
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const local = (p, key) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);

await check('demo: planning needs no network, every promise holds', async () => {
  const p = await open();
  p.apiCalls.length = 0;
  const first = await p.textContent('.now-title');
  await p.click('[data-act=done]');
  await p.waitForFunction((f) => document.querySelector('.now-title').textContent !== f, first);
  await p.click('[data-act=more]');
  await p.click('[data-act=skip]');
  await p.click('[data-tab=week]');
  await p.click('[data-tab=goals]');
  await p.click('[data-tab=today]');
  const planning = p.apiCalls.filter((a) => !['/api/config', '/api/data'].includes(a));
  assert.deepEqual(planning, []);
  assert.match(await p.textContent('#promises-sum'), /8 of 8/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check('layout: no sideways scroll on a phone', async () => {
  const p = await open();
  for (const tab of ['today', 'week', 'goals']) {
    await p.click(`[data-tab=${tab}]`);
    assert.equal(await overflow(p), 0, tab);
  }
  await p.context().close();
});

await check('sample week: goals, trend, a warning, nothing counted', async () => {
  const p = await open();
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  await p.click('[data-tab=goals]');
  assert.ok((await p.locator('.goal').count()) >= 4);
  assert.match(await p.textContent('#goals-card'), /Falling behind/);
  await p.click('[data-tab=week]');
  await p.waitForSelector('#trend-card:not([hidden]) .tb');
  assert.equal(await p.locator('.trend > div').count(), 4);
  await p.click('[data-tab=today]');
  await p.click('[data-act=done]');
  assert.equal((await local(p, 'meso-stats'))?.doneMin ?? 0, 0);
  await p.click('#sample-exit');
  await p.waitForFunction(() => localStorage.getItem('meso-mode') === 'demo');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check('hand edits: saved at once, finished work survives, bad input refused in place', async () => {
  const p = await open();
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  await p.click('[data-act=done]');
  await p.click('[data-tab=week]');
  await p.click('summary[data-t=editRoles]');
  await p.locator('#ed-roles input[type=text]').first().fill('Studying');
  await p.click('summary[data-t=editTasks]');
  await p.locator('[data-add=tasks]').click();
  await p.click('#edit-save');
  assert.match(await p.textContent('#edit-status'), /needs a title/);
  await p.locator('#ed-tasks input[type=text]').last().fill('Added by hand');
  await p.click('#edit-save');
  await p.waitForFunction(() => document.getElementById('edit-bar').hidden);
  const t = await local(p, 'meso-template');
  const s = await local(p, 'meso-state');
  assert.equal(t.roles[0].name, 'Studying');
  assert.ok(t.tasks.some((x) => x.title === 'Added by hand'));
  assert.equal(s.queue.filter((q) => q.status === 'done').length, 1);
  await p.context().close();
});

await check('a new week closes the old one and keeps the debt', async () => {
  const p = await open();
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  const t = await local(p, 'meso-template');
  const s = await local(p, 'meso-state');
  await p.context().close();
  delete t.sample;
  t.tasks[0].debt = true;
  const q = await open({
    time: '2026-11-09T08:00:00+07:00',
    seed: { 'meso-template': JSON.stringify(t), 'meso-state': JSON.stringify(s), 'meso-mode': 'real', 'meso-consent': '2026-11-01' },
  });
  await q.waitForFunction(() => JSON.parse(localStorage.getItem('meso-template')).weekStart === '2026-11-09');
  await q.waitForSelector('#see-review');
  const m = await local(q, 'meso-template');
  assert.equal(m.history.length, 4);
  assert.deepEqual(m.done, {});
  assert.equal(m.tasks[0].debt, true);
  await q.click('#see-review');
  await q.click('#review-skip');
  assert.ok(await q.locator('#week-banner').isHidden());
  await q.context().close();
});

await check('after midnight it is still the same day', async () => {
  const p = await open({ time: '2026-11-04T00:30:00+07:00' });
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  const day = await p.evaluate(() => {
    const d = new Date();
    return d.getHours();
  });
  assert.equal(day, 0);
  assert.equal((await local(p, 'meso-state')).date, '2026-11-03');
  await p.context().close();
});

await check('offline: the app reloads and keeps planning, the AI says it needs a connection', async () => {
  const p = await open({ sw: 'allow', time: new Date().toISOString(), seed: { 'meso-consent': '2026-11-01' } });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  await p.waitForSelector('#now-card .now-title');
  await p.context().setOffline(true);
  await p.reload();
  await p.waitForSelector('#now-card .now-title', { timeout: 8000 });
  await p.waitForSelector('#offline-bar:not([hidden])');
  const first = await p.textContent('.now-title');
  await p.click('[data-act=done]');
  await p.waitForFunction((f) => document.querySelector('.now-title').textContent !== f, first);
  await p.fill('#say', 'test');
  await p.click('#send');
  await p.waitForFunction(() => /needs a connection/.test(document.getElementById('status').textContent));
  await p.context().close();
});

await check('the guided demo survives the AI being down: a labelled recording plays', async () => {
  const p = await open();
  await p.route('**/api/agent', (r) => r.abort());
  await p.click('#try');
  await p.waitForSelector('[data-opt="0"]', { timeout: 20000 });
  assert.match(await p.textContent('#status'), /recording/i);
  assert.ok((await p.locator('.option').count()) >= 1);
  await p.click('[data-opt="0"]');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('meso-state')).queue.some((q) => q.status === 'cut'));
  await p.click('#undo');
  await p.waitForFunction(() => !JSON.parse(localStorage.getItem('meso-state')).queue.some((q) => q.status === 'cut'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check('a deadline that cannot be met shows at once, with a way to act', async () => {
  const p = await open();
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  const t = await local(p, 'meso-template');
  const s = await local(p, 'meso-state');
  await p.context().close();
  for (let i = 0; i < 12; i++) t.tasks.push({ id: `z${i}`, title: `Thesis part ${i}`, roleId: 'r1', minutes: 180, rank: 1, deadline: '2026-11-04', status: 'todo' });
  const q = await open({ seed: { 'meso-template': JSON.stringify(t), 'meso-state': JSON.stringify({ ...s, now: 600 }), 'meso-mode': 'real', 'meso-consent': '2026-11-01' } });
  await q.waitForSelector('#risk-bar:not([hidden])');
  assert.match(await q.textContent('#risk-bar'), /short/);
  await q.context().close();
});

await check('finishing everything offers one more block from the backlog', async () => {
  const p = await open();
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  for (let i = 0; i < 12 && await p.locator('[data-act=done]').count(); i++) {
    const title = await p.textContent('.now-title');
    await p.click('[data-act=done]');
    await p.waitForFunction((f) => document.querySelector('.now-title').textContent !== f, title);
  }
  await p.waitForSelector('#pull-more');
  await p.click('#pull-more');
  await p.waitForSelector('[data-act=done]');
  await p.context().close();
});

await check('resetting the demo clears the conversation and the proposal, and the agent hears none of it', async () => {
  const p = await open({ seed: CONSENT });
  await p.route('**/api/agent', (r) => r.abort());
  await p.click('#try');
  await p.waitForSelector('[data-opt="0"]', { timeout: 20000 });
  await p.click('#demo-box summary');
  await p.click('#reset');
  await p.waitForFunction(() => !document.querySelector('[data-opt="0"]'));
  assert.equal(await p.textContent('#answer'), '');
  await p.unroute('**/api/agent');
  let sent = null;
  await p.route('**/api/agent', (r) => { sent = r.request().postDataJSON(); return answer(r, { state: sent.state }); });
  await p.fill('#say', 'hello again');
  await p.click('#send');
  await p.waitForFunction(() => document.querySelector('#answer .reply'));
  assert.deepEqual([sent.history, sent.pending], [[], null]);
  assert.equal(await p.locator('#undo').count(), 0);
  await p.context().close();
});

await check('an AI answer that arrives after a reset is dropped', async () => {
  const p = await open({ seed: CONSENT });
  const s = await local(p, 'meso-state');
  let release;
  const held = new Promise((r) => { release = r; });
  await p.route('**/api/agent', async (r) => { await held; await answer(r, { reply: 'LATE', state: { ...s, now: 1200 } }); });
  await p.fill('#say', 'hello');
  await p.click('#send');
  await p.waitForFunction(() => document.getElementById('send').disabled);
  await p.click('#demo-box summary');
  await p.click('#reset');
  await p.waitForFunction(() => !document.getElementById('send').disabled);
  release();
  await p.waitForTimeout(300);
  assert.equal(await p.textContent('#answer'), '');
  assert.notEqual((await local(p, 'meso-state')).now, 1200);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check('offline keeps the session, and only the server can end it', async () => {
  const p = await open({ seed: { 'meso-sid': SID }, before: (pg) => pg.route('**/api/data', (r) => r.abort()) });
  await p.waitForSelector('#logout:not([hidden])');
  assert.match(await p.textContent('#account-text'), /back online/);
  assert.equal(await p.evaluate(() => localStorage.getItem('meso-sid')), SID);
  await p.unroute('**/api/data');
  await p.evaluate(() => dispatchEvent(new Event('online'))); // the real server answers 401 to a made-up session
  await p.waitForFunction(() => !localStorage.getItem('meso-sid'));
  assert.ok(await p.locator('#logout').isHidden());
  await p.context().close();
});

await check('a device that cannot read the saved plan writes nothing over it, and reads first when back', async () => {
  const { seed } = await realWeek();
  const calls = [];
  const p = await open({
    seed: { ...seed, 'meso-sid': SID },
    before: (pg) => pg.route('**/api/data', (r) => { calls.push(r.request().method()); return r.abort(); }),
  });
  await p.click('[data-act=done]');
  await p.waitForTimeout(2200);
  assert.deepEqual(calls, ['GET']);
  assert.ok(await p.locator('#save-note').isVisible());
  await p.unroute('**/api/data');
  await p.route('**/api/data', (r) => {
    calls.push(r.request().method());
    return r.fulfill({ json: r.request().method() === 'GET' ? { ok: true, user: { name: 'A', email: 'a@b.c' }, data: null } : { ok: true } });
  });
  await p.evaluate(() => dispatchEvent(new Event('online')));
  await p.waitForFunction(() => document.getElementById('save-note').hidden);
  await p.waitForTimeout(1800);
  assert.deepEqual(calls, ['GET', 'GET', 'POST']);
  await p.context().close();
});

await check('opening a saved plan writes nothing back', async () => {
  const { t, s, seed } = await realWeek();
  const saved = { ...t, checkinDate: s.date }; // the morning check-in is a change, once a day
  const posts = [];
  const p = await open({
    seed: { ...seed, 'meso-sid': SID, 'meso-template': JSON.stringify(saved) },
    before: (pg) => pg.route('**/api/data', (r) => {
      if (r.request().method() === 'POST') posts.push(1);
      return r.fulfill({ json: { ok: true, user: { name: 'A', email: 'a@b.c' }, data: { template: saved, state: s, stats: null } } });
    }),
  });
  await p.waitForSelector('#logout:not([hidden])');
  await p.waitForTimeout(2200);
  assert.equal(posts.length, 0);
  await p.context().close();
});

await check('a new day is not an edit, so a newer copy from another device still wins', async () => {
  const { t, s, seed } = await realWeek();
  const phone = { ...t, updatedAt: 5000, roles: t.roles.map((r, i) => (i ? r : { ...r, name: 'From the phone' })) };
  const p = await open({
    time: '2026-11-05T08:00:00+07:00',
    seed: { ...seed, 'meso-sid': SID, 'meso-template': JSON.stringify({ ...t, updatedAt: 1000 }) },
    before: (pg) => pg.route('**/api/data', (r) => r.fulfill({ json: { ok: true, user: { name: 'A', email: 'a@b.c' }, data: { template: phone, state: s, stats: null } } })),
  });
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('meso-template')).roles[0].name === 'From the phone');
  assert.equal((await local(p, 'meso-state')).date, '2026-11-05');
  await p.context().close();
});

await check('finishing early on a real day starts the next block now', async () => {
  const { seed } = await realWeek();
  const p = await open({ seed });
  const now = (await local(p, 'meso-state')).now;
  assert.equal(now, 600);
  await p.click('[data-act=done]');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('meso-state')).queue.some((q) => q.status === 'done'));
  assert.equal((await local(p, 'meso-state')).now, now);
  await p.context().close();
});

await check('finished work counts at once on the goals', async () => {
  const p = await open();
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  const before = await p.textContent('#goals-card');
  await p.click('[data-act=done]');
  await p.waitForFunction((b) => document.getElementById('goals-card').textContent !== b, before);
  await p.context().close();
});

await check('after midnight the agent is told yesterday\'s weekday, like the date', async () => {
  const { seed } = await realWeek();
  const p = await open({ time: '2026-11-04T00:30:00+07:00', seed });
  let sent = null;
  await p.route('**/api/agent', (r) => { sent = r.request().postDataJSON(); return answer(r, { state: sent.state }); });
  await p.fill('#say', 'hello');
  await p.click('#send');
  await p.waitForFunction(() => document.querySelector('#answer .reply'));
  assert.equal(sent.weekday, 2); // Tuesday, though the calendar says Wednesday
  await p.context().close();
});

await check('leaving the sample leaves nothing of it behind, and the demo has a way back to your week', async () => {
  const { seed } = await realWeek();
  const p = await open({ seed });
  await p.click('#to-demo');
  await p.waitForSelector('#to-week');
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  await p.route('**/api/agent', (r) => { const { state } = r.request().postDataJSON(); return answer(r, { state: { ...state, fixed: [...state.fixed, { id: 'fix-9', title: 'Meeting', start: 700, end: 760 }] } }); });
  await p.fill('#say', 'meeting');
  await p.click('#send');
  await p.waitForSelector('#undo');
  await p.click('#sample-exit');
  await p.waitForFunction(() => !JSON.parse(localStorage.getItem('meso-template')).sample);
  assert.equal(await p.locator('#undo').count(), 0);
  await p.click('#to-demo');
  await p.waitForSelector('#to-week');
  await p.click('#to-week');
  await p.waitForSelector('#real-row:not([hidden])');
  assert.equal(await p.evaluate(() => localStorage.getItem('meso-mode')), 'real');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check('a saved day this version cannot read never leaves a blank screen', async () => {
  const demo = await open({ seed: { 'meso-state': '{"nonsense":true}' } });
  assert.ok(await demo.locator('[data-act=done]').isVisible());
  await demo.context().close();
  const { seed } = await realWeek();
  const real = await open({ seed: { ...seed, 'meso-state': '{"nonsense":true}' } });
  assert.ok(await real.locator('[data-act=done]').isVisible());
  await real.context().close();
});

await check('a connection that hangs does not hold the first screen', async () => {
  const p = await open({ before: (pg) => pg.route('**/api/config', () => {}) });
  assert.ok(await p.locator('[data-act=done]').isVisible());
  await p.context().close();
});

await check('Enter sends, Shift+Enter starts a new line', async () => {
  const p = await open({ seed: CONSENT });
  let calls = 0;
  await p.route('**/api/agent', (r) => { calls++; return answer(r, { state: r.request().postDataJSON().state }); });
  await p.fill('#say', 'line one');
  await p.press('#say', 'Shift+Enter');
  assert.equal(calls, 0);
  await p.press('#say', 'Enter');
  await p.waitForFunction(() => document.querySelector('#answer .reply'));
  assert.equal(calls, 1);
  await p.context().close();
});

await check('a cleared demo clock changes nothing', async () => {
  const p = await open();
  await p.click('#demo-box summary');
  await p.fill('#clock', '');
  await p.dispatchEvent('#clock', 'change');
  assert.equal((await local(p, 'meso-state')).now, 420);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check('when the AI stops answering, the guided demo does not wait for ever', async () => {
  const p = await open();
  await p.route('**/api/agent', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'ai', error: 'x' }) }));
  await p.click('#try');
  await p.waitForSelector('[data-opt="0"]', { timeout: 20000 });
  assert.match(await p.textContent('#status'), /recording/i);
  await p.context().close();
});

await check('first screen: the demo is one tap away, with no sign-in and no age question', async () => {
  const p = await open();
  assert.ok(await p.locator('#try').isVisible());
  assert.match(await p.textContent('.hero'), /Say what happened/);
  assert.ok(!(await p.locator('#consent-sheet').evaluate((d) => d.open)));
  await p.context().close();
});

await check('typing your own words asks for consent once, in the app', async () => {
  const p = await open();
  await p.route('**/api/agent', (r) => r.abort());
  await p.fill('#say', 'hello');
  await p.click('#send');
  await p.waitForSelector('#consent-sheet[open]');
  await p.click('#consent-no');
  assert.equal(await p.inputValue('#say'), 'hello');
  await p.click('#send');
  await p.click('#consent-yes');
  await p.waitForFunction(() => localStorage.getItem('meso-consent'));
  await p.context().close();
});

await check('a calendar file is read on the device, with nothing sent', async () => {
  const p = await open();
  await p.click('#sample-open');
  await p.waitForSelector('#sample-bar:not([hidden])');
  await p.click('[data-tab=goals]');
  p.apiCalls.length = 0;
  await p.setInputFiles('#doc-file', { name: 'cal.ics', mimeType: 'text/calendar', buffer: Buffer.from('BEGIN:VEVENT\r\nSUMMARY:Lab\r\nDTSTART:20261110T090000\r\nDTEND:20261110T110000\r\nEND:VEVENT\r\n') });
  await p.waitForSelector('#import-add');
  assert.deepEqual(p.apiCalls, []);
  await p.click('#import-add');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('meso-template')).fixed.some((f) => f.title === 'Lab'));
  await p.context().close();
});

if (AI) {
  await check('AI: a sample syllabus becomes a list to approve, then real deadlines', async () => {
    const p = await open();
    await p.click('#sample-open');
    await p.waitForSelector('#sample-bar:not([hidden])');
    await p.click('[data-tab=goals]');
    await p.click('#import-sample');
    await p.click('#consent-yes').catch(() => {});
    await p.waitForSelector('#import-add', { timeout: 40000 });
    assert.ok((await p.locator('.pick').count()) >= 5);
    assert.match(await p.textContent('#import-add'), /Add \d+/);
    const before = (await local(p, 'meso-template')).tasks.length;
    await p.click('#import-add');
    await p.waitForFunction((n) => JSON.parse(localStorage.getItem('meso-template')).tasks.length > n, before);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  await check('AI: saying which option you want applies it, in English and Vietnamese', async () => {
    for (const [lang, words] of [['en', 'option 2'], ['vi', 'chọn cách 2']]) {
      const p = await open({ seed: { 'meso-consent': '2026-11-01', 'meso-lang': lang, 'meso-intro': 'x' } });
      await p.click('#try');
      await p.waitForSelector('[data-opt="1"]', { timeout: 40000 });
      await p.fill('#say', words);
      await p.click('#send');
      await p.waitForFunction(() => JSON.parse(localStorage.getItem('meso-state')).queue.some((q) => q.status === 'cut'), null, { timeout: 30000 });
      await p.context().close();
    }
  });

  await check('AI: set up a week from a description, with goals', async () => {
    const p = await open();
    await p.click('#setup-open');
    await p.fill('#setup-text', 'Student. Goal: GPA 3.6 this term. Study 15 hours a week, never under 8. Family 2 hours. Biology Monday 8 to 11. Up at 7, bed at 1am.');
    await p.check('#setup-consent');
    await p.click('#setup-go');
    await p.waitForSelector('#setup', { state: 'hidden', timeout: 60000 });
    const t = await local(p, 'meso-template');
    assert.equal(t.sleep, '01:00');
    assert.ok(t.goals.length >= 1);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  await check('AI: the broken afternoon ends in a proposal, and nothing is cut before approval', async () => {
    const p = await open();
    await p.click('#try');
    await p.waitForSelector('[data-opt="0"]', { timeout: 40000 });
    const s = await local(p, 'meso-state');
    assert.equal(s.queue.filter((q) => q.status === 'cut').length, 0);
    await p.click('[data-opt="0"]');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('meso-state')).queue.some((q) => q.status === 'cut'));
    await p.context().close();
  });
}

await browser.close();
console.log(`\n${checks - failures.length} of ${checks} passed`);
process.exit(failures.length ? 1 : 0);
