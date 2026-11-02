import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers, view } from '../public/core/handlers.js';
import worker from '../src/worker.js';

test('the browser handlers run the whole day with no server', () => {
  const start = handlers['/api/demo']({ now: '07:00', lang: 'en' });
  const first = start.view.queue[0];
  const done = handlers['/api/tool']({ state: start.state, name: 'update_item', args: { id: first.id, status: 'done', minutes: 60 } });
  assert.equal(done.ok, true);
  assert.notEqual(done.view.queue[0].id, first.id);
  const week = handlers['/api/week']({ state: done.state, weekday: 5 });
  assert.equal(week.ok, true);
  assert.ok(Array.isArray(week.days));
});

test('hand edits are refused with the reason, in the language of the user', () => {
  const day = { date: '2026-11-03', weekday: 2, lang: 'vi' };
  const { template, state } = handlers['/api/sample'](day);
  const bad = { ...template, roles: template.roles.map((r, i) => (i ? r : { ...r, floorMin: 99999 })) };
  const out = handlers['/api/edit']({ template: bad, state, weekday: 2, lang: 'vi' });
  assert.equal(out.ok, false);
  assert.match(out.error, /tối thiểu/);
  assert.equal(handlers['/api/edit']({ template, state, weekday: 2 }).ok, true);
});

test('planning routes no longer exist on the server', async () => {
  for (const route of Object.keys(handlers)) {
    const res = await worker.fetch(new Request(`http://x${route}`, { method: 'POST', body: '{}' }), {}, {});
    assert.equal(res.status, 404, route);
  }
});

test('view shows today from a state', () => {
  const { state } = handlers['/api/demo']({ now: '09:00' });
  assert.equal(view(state).now, '09:00');
});

test('a length the person set by hand is marked, so it is never shown as learned pace', () => {
  const start = handlers['/api/demo']({ now: '07:00', lang: 'en' });
  const id = start.state.queue.find((q) => q.status === 'todo').id;
  const more = handlers['/api/tool']({ state: start.state, name: 'update_item', args: { id, status: 'more_time', minutes: 15 } });
  assert.equal(more.state.queue.find((q) => q.id === id).touched, true);
  const part = handlers['/api/progress']({ state: start.state, id, minutes: 20 });
  assert.equal(part.state.queue.find((q) => q.id === id).touched, true);
  assert.equal(start.state.queue.find((q) => q.id === id).touched, undefined); // the old state is not mutated
});
