import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from '../src/tools.js';
import { runAgent } from '../src/agent.js';
import { demoState } from '../src/demo-state.js';
import { toMin } from '../src/planner.js';

// A scripted fake model: each step returns the next prepared answer.
function fakeModel(steps) {
  let i = 0;
  const seen = [];
  const fn = async (messages) => {
    seen.push(messages.map((m) => ({ ...m })));
    const s = steps[i++];
    if (!s) throw new Error('fake model ran out of steps');
    if (typeof s === 'string') return { text: s, toolCalls: [], message: { content: s } };
    const calls = s.map((c, k) => ({ id: `c${i}-${k}`, name: c[0], args: c[1] }));
    return { text: '', toolCalls: calls, message: { content: '', tool_calls: calls } };
  };
  fn.seen = seen;
  return fn;
}

test('get_state shows the queue with times, and the morning fits', () => {
  const r = runTool(demoState(), 'get_state', {});
  assert.equal(r.ok, true);
  assert.equal(r.result.queue[0].start, '07:00');
  assert.equal(r.result.needsUser, false);
});

test('bad arguments are rejected with a reason and change nothing', () => {
  const s = demoState();
  assert.match(runTool(s, 'add_fixed', { title: 'x', start: '7pm', minutes: 60 }).error, /HH:MM/);
  assert.match(runTool(s, 'update_item', { id: 'nope', status: 'done' }).error, /No open item/);
  assert.match(runTool(s, 'add_item', { title: 'x', role: 'sleep', minutes: 30, rank: '1' }).error, /Unknown role/);
  assert.match(runTool(s, 'reorder', { ids: ['q-1'] }).error, /every open item/);
  assert.match(runTool(s, 'get_state', null).error, /not valid JSON/);
  assert.equal(s.queue.length, 9);
});

test('a late afternoon overflows, and propose refuses cuts that are not enough or break a floor', () => {
  const s = demoState(toMin('17:00'));
  const st = runTool(s, 'get_state', {}).result;
  assert.equal(st.needsUser, true);
  const notEnough = runTool(s, 'propose', { message: 'm', cut_ids: ['q-7'] });
  assert.match(notEnough.error, /still does not fit/);
  // Floors are weekly: with weekend room left, cutting the call home is fine...
  assert.equal(runTool(s, 'propose', { message: 'm', cut_ids: st.doesNotFit.map((x) => x.id).concat('q-9') }).ok, true);
  // ...but with no room left this week it would break the floor, so it is refused.
  const noWeekend = { ...s, week: { ...s.week, people: { ...s.week.people, laterMin: 0 } } };
  const floor = runTool(noWeekend, 'propose', { message: 'm', cut_ids: runTool(noWeekend, 'get_state', {}).result.doesNotFit.map((x) => x.id).concat('q-9') });
  assert.match(floor.error, /Family & friends under its weekly floor/);
  // Seen with the open model on 30/10: an alternative that keeps too much is refused too.
  const badAlt = runTool(s, 'propose', { message: 'm', cut_ids: st.doesNotFit.map((x) => x.id), alternative_cut_ids: ['q-7'] });
  assert.match(badAlt.error, /After alternative_cut_ids the day still does not fit/);
  const ok = runTool(s, 'propose', { message: 'Cut these?', cut_ids: st.doesNotFit.map((x) => x.id) });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.proposal.options[0], st.doesNotFit.map((x) => x.id));
});

test('agent loop: reads state, adds a meeting, recovers from a rejected call, answers', async () => {
  const model = fakeModel([
    [['get_state', {}]],
    [['add_fixed', { title: 'Class committee meeting', start: '7pm', minutes: 60 }]],
    [['add_fixed', { title: 'Class committee meeting', start: '19:00', minutes: 60 }]],
    'Meeting added at 19:00, the rest of the day slid around it.',
  ]);
  const out = await runAgent({ state: demoState(toMin('13:00')), userText: 'họp BCS lúc 7h tối 1 tiếng', chatFn: model });
  assert.equal(out.reply, 'Meeting added at 19:00, the rest of the day slid around it.');
  assert.deepEqual(out.trace.map((t) => [t.tool, t.ok]), [['get_state', true], ['add_fixed', false], ['add_fixed', true]]);
  assert.equal(out.state.fixed.length, 1);
  // The model saw the rejection reason as a tool message.
  const last = model.seen[2].at(-1);
  assert.equal(last.role, 'tool');
  assert.match(last.content, /HH:MM/);
});

test('agent loop stops after 3 rejected calls', async () => {
  const bad = [['update_item', { id: 'ghost', status: 'done' }]];
  const out = await runAgent({ state: demoState(), userText: 'x', chatFn: fakeModel([bad, bad, bad]) });
  assert.equal(out.stopped, 'rejections');
  assert.equal(out.trace.length, 3);
});

test('a proposal from the agent is returned for the user to approve, nothing is cut yet', async () => {
  const s = demoState(toMin('17:00'));
  const cut = runTool(s, 'get_state', {}).result.doesNotFit.map((x) => x.id);
  const out = await runAgent({
    state: s,
    userText: 'chiều nay tôi ngủ quên',
    chatFn: fakeModel([[['get_state', {}]], [['propose', { message: 'Cut these?', cut_ids: cut }]], 'Approve?']),
  });
  assert.deepEqual(out.proposal.options[0], cut);
  assert.ok(out.state.queue.every((i) => i.status === 'todo'));
});
