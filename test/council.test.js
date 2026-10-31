import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoState } from '../public/core/demo-state.js';
import { replan, applyEvent, toMin } from '../public/core/planner.js';
import { checkPlan } from '../public/core/invariants.js';
import { floorBroken } from '../public/core/tools.js';
import { tradeoffCandidates } from '../public/core/tradeoff.js';
import { runCouncil } from '../src/council.js';
import { runAgent } from '../src/agent.js';

const overflowing = () => demoState(toMin('17:00'));

test('every candidate fits the day and keeps every floor', () => {
  const s = overflowing();
  const list = tradeoffCandidates(s);
  assert.ok(list.length >= 2);
  for (const c of list) {
    const after = applyEvent(s, { type: 'cut', ids: c.ids });
    assert.equal(replan(after).needsUser, false);
    assert.deepEqual(floorBroken(s, c.ids), []);
    assert.deepEqual(checkPlan(after, replan(after)), []);
    assert.equal(c.lifeMin + c.workMin, c.minutes);
  }
});

test('candidates are minimal and different', () => {
  const list = tradeoffCandidates(overflowing());
  const keys = list.map((c) => [...c.ids].sort().join());
  assert.equal(new Set(keys).size, keys.length);
  for (const c of list) for (const other of list) {
    if (c !== other) assert.ok(!other.ids.every((id) => c.ids.includes(id)), 'no candidate contains another');
  }
});

test('a day that fits has nothing to trade off', () => {
  assert.deepEqual(tradeoffCandidates(demoState(toMin('07:00'))), []);
});

const cand = (n, lifeMin = 0) => ({ ids: [`q-${n}`], titles: [`Item ${n}`], minutes: 60, lifeMin, workMin: 60 - lifeMin, topRank: 3 });
const says = (deadline, life) => async (system) => JSON.stringify(system.includes('Deadline Guardian') ? deadline : life);

test('a real disagreement gives two cards, the gentler one on people suggested', async () => {
  const candidates = [cand(1, 60), cand(2, 0)];
  const out = await runCouncil({ candidates, ask: says({ option: 1, why: 'keeps the exam safe' }, { option: 2, why: 'keeps dinner with mum' }) });
  assert.equal(out.agreed, false);
  assert.deepEqual(out.options.map((o) => o.by), ['life', 'deadline']);
  assert.equal(out.options[0].suggested, true);
  assert.deepEqual(out.options[0].ids, ['q-2']);
  assert.equal(out.options[1].why, 'keeps the exam safe');
});

test('when both agree the app says so, with a real alternative, never a fake disagreement', async () => {
  const out = await runCouncil({ candidates: [cand(1), cand(2)], ask: says({ option: 2, why: 'A.' }, { option: 2, why: 'B.' }) });
  assert.equal(out.agreed, true);
  assert.equal(out.options[0].by, 'both');
  assert.deepEqual(out.options[0].ids, ['q-2']);
  assert.equal(out.options[0].why, 'A. B.');
  assert.equal(out.options[1].by, 'code');
  assert.deepEqual(out.options[1].ids, ['q-1']);
});

test('an invented option or broken JSON cannot get through', async () => {
  const candidates = [cand(1), cand(2)];
  const one = await runCouncil({ candidates, ask: says({ option: 9, why: 'mine' }, { option: 1, why: 'ok' }) });
  assert.deepEqual(one.options.map((o) => o.by), ['life', 'code']);
  assert.equal(await runCouncil({ candidates, ask: async () => 'not json' }), null);
  assert.equal(await runCouncil({ candidates, ask: async () => { throw new Error('down'); } }), null);
  assert.equal(await runCouncil({ candidates: [], ask: says({}, {}) }), null);
});

test('dashes in a reason are cleaned', async () => {
  const dash = String.fromCharCode(0x2014);
  const out = await runCouncil({ candidates: [cand(1)], ask: says({ option: 1, why: `one ${dash} two` }, { option: 1, why: 'ok' }) });
  assert.ok(!out.options[0].why.includes(dash));
});

function script(steps) {
  let i = 0;
  const fn = async () => { fn.calls = ++i; const s = steps[i - 1]; return typeof s === 'string' ? { text: s, toolCalls: [], message: {} } : { text: '', toolCalls: s.map((c, k) => ({ id: `c${k}`, name: c[0], args: c[1] })), message: {} }; };
  return fn;
}

test('agent: propose without ids asks the council and ends the turn', async () => {
  const s = overflowing();
  let asked = 0;
  const councilFn = async (state) => { asked++; return runCouncil({ candidates: tradeoffCandidates(state), ask: says({ option: 1, why: 'a' }, { option: 2, why: 'b' }) }); };
  const model = script([[['propose', { message: 'Two ways to do this.' }]], 'never']);
  const out = await runAgent({ state: s, userText: 'x', chatFn: model, councilFn });
  assert.equal(asked, 1);
  assert.equal(model.calls, 1);
  assert.equal(out.reply, 'Two ways to do this.');
  assert.equal(out.proposal.options.length, 2);
  assert.ok(out.proposal.options.every((o) => o.ids.length && o.by));
  assert.ok(out.state.queue.every((q) => q.status === 'todo'), 'nothing is cut before the person answers');
});

test('agent: if the council fails, the options computed by code still reach the person', async () => {
  const out = await runAgent({ state: overflowing(), userText: 'x', chatFn: script([[['propose', { message: 'Choose.' }]]]), councilFn: async () => null });
  assert.ok(out.proposal.options.length >= 1);
  assert.equal(out.proposal.options[0].by, 'code');
  assert.ok(out.proposal.options[0].ids.length);
});

test('agent: a spoken answer takes the option objects', async () => {
  const s = overflowing();
  const id = s.queue.find((q) => q.rank === 'extra').id;
  const pending = { options: [{ ids: [id], by: 'life', why: 'x' }] };
  const out = await runAgent({ state: s, userText: 'option 1', chatFn: script([[['accept_proposal', { option: 1 }]], 'Done.']), pending });
  assert.equal(out.state.queue.find((q) => q.id === id).status, 'cut');
});

test('agent: every tool step reports the plan as it stands, so the screen can move at once', async () => {
  const seen = [];
  await runAgent({
    state: demoState(toMin('13:00')),
    userText: 'x',
    chatFn: script([[['add_fixed', { title: 'Meeting', start: '19:00', minutes: 60 }]], 'Done.']),
    onStep: (step) => seen.push(step),
  });
  assert.equal(seen[0].state.fixed.length, 1);
});

test('agent: the council starts as soon as a cut is needed, and runs once', async () => {
  let runs = 0;
  let startedBeforeAsked = false;
  const councilFn = async (state) => { runs++; return runCouncil({ candidates: tradeoffCandidates(state), ask: says({ option: 1, why: 'a' }, { option: 2, why: 'b' }) }); };
  const steps = [[['add_fixed', { title: 'Meeting', start: '19:00', minutes: 60 }]], [['propose', { message: 'It no longer fits.' }]]];
  let i = 0;
  const model = async () => {
    if (i === 1) { await new Promise((r) => setTimeout(r, 5)); startedBeforeAsked = runs === 1; }
    const s = steps[i++];
    return { text: '', toolCalls: s.map((c, k) => ({ id: `c${k}`, name: c[0], args: c[1] })), message: {} };
  };
  const out = await runAgent({ state: overflowing(), userText: 'x', chatFn: model, councilFn });
  assert.equal(startedBeforeAsked, true);
  assert.equal(runs, 1);
  assert.equal(out.proposal.options.length, 2);
});

test('agent: if the model forgets to ask, code asks', async () => {
  const councilFn = async (state) => runCouncil({ candidates: tradeoffCandidates(state), ask: says({ option: 1, why: 'a' }, { option: 2, why: 'b' }) });
  const out = await runAgent({ state: overflowing(), userText: 'x', chatFn: script([[['add_fixed', { title: 'Meeting', start: '19:00', minutes: 60 }]], 'Added the meeting.']), councilFn });
  assert.ok(out.proposal?.options.length >= 1);
  assert.equal(out.reply, 'Added the meeting.');
  assert.equal(out.trace.at(-1).tool, 'propose');
});

test('agent: a plain question on a tight day does not force a proposal', async () => {
  const out = await runAgent({ state: overflowing(), userText: 'x', chatFn: script(['You have a lot on.']), councilFn: async () => { throw new Error('must not run'); } });
  assert.equal(out.proposal, null);
});
