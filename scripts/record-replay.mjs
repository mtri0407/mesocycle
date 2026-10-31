// Records one real run of the demo scenario from the live app. The guided demo
// plays this back, labelled as a recording, if the AI cannot answer at that moment.
//   node scripts/record-replay.mjs [en|vi]
import { writeFileSync } from 'node:fs';
import { demoState } from '../public/core/demo-state.js';

const BASE = process.env.BASE || 'https://mesocycle.minhtriphamnguyen69.workers.dev';
const TEXT = {
  en: "I slept through the afternoon, and there's a class meeting at 7pm for an hour",
  vi: 'Chiều nay tôi ngủ quên, 7 giờ tối có họp ban cán sự 1 tiếng',
};

for (const lang of process.argv[2] ? [process.argv[2]] : ['en', 'vi']) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: demoState(17 * 60, lang), text: TEXT[lang], stream: true, lang }),
  });
  const events = [];
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) events.push({ at: Date.now() - started, ...JSON.parse(line) });
    }
  }
  const done = events.at(-1);
  if (!done?.ok || !done.proposal) throw new Error(`no proposal in the ${lang} run: ${done?.error || done?.reply}`);
  writeFileSync(new URL(`../public/core/replay-${lang}.json`, import.meta.url), JSON.stringify(events));
  console.log(lang, events.length, 'events,', ((events.at(-1).at) / 1000).toFixed(1), 's');
}
