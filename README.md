# Mesocycle

**A planning agent that re-plans your day when life breaks the plan, and never trades your whole life for productivity.**

Built for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Indie track, theme: Build for Your World), October 27 to November 4, 2026.

**Live demo:** https://mesocycle.minhtriphamnguyen69.workers.dev

## The problem

I'm a first-year IT student who also runs a small education company and trains powerlifting. I plan every day in blocks. Then reality happens: I start 40 minutes late, a block takes twice as long, a meeting appears at 7pm. In a calendar where every task has a fixed time, one slip pushes everything after it, and by evening the whole day has collapsed.

I built a planner with an automatic "reschedule" button before this hackathon, and I stopped using it. It needed setup, it guessed where to put missed work in a future that hadn't happened yet, and it treated every minute as equal. What actually worked was talking the plan through with an AI chat. Mesocycle is that conversation, with memory of my week and rules that can't be broken.

## How it works

- **Only fixed events have hard times** (classes, exams, meetings, sleep). Flexible work is an ordered queue that slides when you're late, so a slip never cascades.
- **Missed work becomes debt**, not a guess about tomorrow. It's paid back when there is real free time.
- **Weekly floors protect your life.** Each role (university, company, training, family and friends) has a weekly minimum. Mesocycle never proposes a cut that would push a role under its floor while the rest of the week can't make up for it.
- **It only asks when it must**: when work has to be cut or a deadline is at risk, with a default and an alternative. Small slips are handled silently.
- **Plans at most 60% of free time.** The rest absorbs meals, transitions and the unexpected.

### The agent and the guardrails

```
 voice (Muse Voice Transcribe) ─┐
 photo (Muse Spark vision) ─────┼─> Muse Spark agent ──tool calls──> src/tools.js ──> src/planner.js
 text ──────────────────────────┘        ^                               │ checks every argument
                                         └──── rejection + reason ───────┘ and every rule
```

The model never edits the plan. It calls six tools (`get_state`, `add_fixed`, `add_item`, `update_item`, `reorder`, `propose`). Every call is validated in code. If the model proposes something that breaks a rule (a cut that still doesn't fit, an alternative that pushes "Family & friends" under its floor), the tool rejects it with the reason, and the model reads the reason and corrects itself. The "Agent steps" panel in the app shows these ✗ and ✓ steps.

## Use of Meta AI

| Feature | Model | Access |
|---|---|---|
| Planning agent with tool calling | `muse-spark-1.3` | Meta Model API |
| Same agent on open weights | `meta-models/muse-spark-open-1026` | Baseten |
| Reading a timetable or task-list photo | `muse-spark-1.3` (image understanding) | Meta Model API |
| Voice check-in | `muse-voice-transcribe-1.0` | Meta Model API |

Both chat providers speak the OpenAI Chat Completions format, so `src/models.js` switches with one setting. The model picker in the app runs the same agent, tools and rules on either model.

## Stress test: 100,000 broken days

The planner's promises are written as checks in `src/invariants.js`: never plan into sleep, never move a fixed event, never let a task silently disappear, never fill more than the fill ratio, never cut without asking, never go under a floor silently. `scripts/simulate.js` lives through randomly broken days (late starts, overruns, interruptions, skips, new work) and runs every check after every re-plan:

```
npm run simulate
Simulated 100,000 broken days, 994,609 re-plans in 44523 ms (seed 20261027).
Events: work 509,327, add 65,403, late 100,702, cut 66,940, skip 69,963, interrupt 90,277
Broken promises: 0
```

The checker itself was tested by planting bugs on purpose (sleep overrun, silent cut, ignored fill ratio); each was caught within the first 1,000 days.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # put your keys in .dev.vars
npm test                         # 25 tests, no model calls
npm run simulate                 # the stress test
npm run dev                      # open http://localhost:8787
```

Keys are read from environment variables (`MODEL_API_KEY`, `BASETEN_API_KEY`). `.dev.vars` is git-ignored; in production they are Cloudflare secrets. Runs on Cloudflare Workers.

## Boundaries

Mesocycle is a time-planning tool. It does not give medical, mental health, nutrition or training advice. If you say you're tired or stressed, it only asks how much time you have today.

## Built during the hackathon

Everything in this repository was written during the hackathon (first commit: October 27, 2026); the daily history is in the commits and in `docs/`. My earlier planner app was not reused; Mesocycle is new code, designed from what that app taught me.

AI coding assistants were used during development. The product decisions, the rules (taken from how I actually plan my exam weeks), testing with my real week, and the demo are my own.

## License

MIT
