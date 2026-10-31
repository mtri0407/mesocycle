# Mesocycle

**A planning agent that re-plans your day when life breaks the plan, and never trades your whole life for productivity.**

Built for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Indie track, theme: Build for Your World), October 27 to November 4, 2026.

**Live demo:** https://mesocycle.minhtriphamnguyen69.workers.dev

## The problem

I'm a first-year IT student who also runs a small education company and trains powerlifting. I plan every day in blocks. Then reality happens: I start 40 minutes late, a block takes twice as long, a meeting appears at 7pm. In a calendar where every task has a fixed time, one slip pushes everything after it, and by evening the whole day has collapsed.

I built a planner with an automatic "reschedule" button before this hackathon, and I stopped using it. It needed setup, it guessed where to put missed work in a future that hadn't happened yet, and it treated every minute as equal. What actually worked was talking the plan through with an AI chat. Mesocycle is that conversation, with memory of my week and rules that can't be broken.

## What you can do

1. **Set up your week in about a minute.** Describe it in your own words (typed or spoken, English or Vietnamese), add a photo of your timetable if you have one. Muse Spark builds your roles, weekly minimums, fixed classes and work blocks through one checked tool call.
2. **Follow one card: Now.** Done, need 15 more minutes, or can't do it. The rest of the day slides on an animated timeline.
3. **Say what changed.** "I slept through the afternoon, meeting at 7pm." The agent re-plans and asks before cutting anything, with a default and an alternative.
4. **It notices when you fall behind.** If the current block runs over, Mesocycle offers to re-plan before you have to ask.
5. **See the week.** Today's debt is shown landing on the days that still have room, next to each role's weekly minimum.
6. **Connect it to your goals.** Goals (a GPA, a revenue target, an exam) link to the roles that serve them, show the hours they got this week, and warn when they fall behind pace.
7. **Close the loop every week.** A new week closes the old one automatically: plan against reality by role, debt carried over. Muse Spark then proposes next week's hours from what really happened, with a reason for each change. Nothing applies until you approve it, and code rejects any proposal that drops a floor or asks for more hours than the week can hold. Goals, fixed events and sleep are out of its reach.
8. **Edit anything directly.** Roles, fixed events, tasks, goals, wake and sleep. Editing mid-day keeps finished work, debt and what the agent added.
9. **Start the day with a check-in.** The first open of each day gets a short read-only summary from Muse Spark: what comes first, what matters most, and one question.
10. **Talk, and watch the words appear.** Speech streams live through the Worker to Muse Voice Transcribe. If the live connection fails, the recording is transcribed the old way, so nothing you said is lost.

Or press **Try the demo** to replay the author's real broken Friday before midterms.

## Why not Motion, Reclaim or Google Calendar?

Motion and Reclaim are serious products, and by their own descriptions they also move work when plans change: Motion "recalculates your schedule when plans change", and Reclaim "dynamically adapts meetings, tasks, and focus time". The differences below are design choices in Mesocycle, checked against this repository; I have not tested those products in depth.

| Mesocycle's choice | Why |
|---|---|
| Today only: flexible work is a queue, and later days are never filled in advance | Missed work becomes debt instead of a guess about a future that has not happened |
| Weekly floors are hard rules in code | Family or training cannot silently lose to work; a cut that breaks a floor is rejected |
| You describe a broken day in one sentence, by voice or text | No dragging blocks around when you are already behind |
| The AI cannot edit your plan, only call checked tools, and every step is shown | 100,000 simulated broken days, 0 broken promises |
| Sleep is never moved by the agent, and at most 60% of free time is planned | The plan assumes real life happens |
| Open source, and runs on open weights too | The same agent works on Muse Spark Open |

Google Calendar stores the events you put in it; re-planning a broken day is left to you.

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
| Live voice input, streamed through the Worker | `muse-voice-transcribe-1.0` (realtime WebSocket, with the batch endpoint as fallback) | Meta Model API |
| Next-week proposal and morning check-in | `muse-spark-1.3` | Meta Model API |

Both chat providers speak the OpenAI Chat Completions format, so `src/models.js` switches with one setting. The model picker in the app runs the same agent, tools and rules on either model.

## Muse Spark vs Muse Spark Open

The same agent, tools and rules on both models, 10 scenarios in English and Vietnamese (`scripts/benchmark.js`, details in `docs/BENCHMARK.md`):

| Model | Runs | Task done, rules kept | No rejected call | Median model calls | Median time |
|---|---|---|---|---|---|
| Muse Spark 1.3 | 20 | 18/20 (90%) | 20/20 (100%) | 3 | 9.9s |
| Muse Spark Open | 20 | 19/20 (95%) | 20/20 (100%) | 3 | 9.6s |

The open-weight model is as reliable as the hosted one on this agent. Code-checked cut options in the plan (see `cutOptions` in `src/tools.js`) cut the median turn from 30 to 50 seconds to about 10.

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
npm test                         # 47 tests, no model calls
npm run simulate                 # the stress test
npm run dev                      # open http://localhost:8787
```

Keys are read from environment variables (`MODEL_API_KEY`, `BASETEN_API_KEY`). `.dev.vars` is git-ignored; in production they are Cloudflare secrets. Runs on Cloudflare Workers.

## Privacy

See the [privacy policy](https://mesocycle.minhtriphamnguyen69.workers.dev/privacy). You must be 18 or older. Signed-in users can delete their data from the app.

## Boundaries

Mesocycle is a time-planning tool. It does not give medical, mental health, nutrition or training advice. If you say you're tired or stressed, it only asks how much time you have today.

## Built during the hackathon

Everything in this repository was written during the hackathon (first commit: October 27, 2026); the daily history is in the commits and in `docs/`. My earlier planner app was not reused; Mesocycle is new code, designed from what that app taught me.

AI coding assistants were used during development. The product decisions, the rules (taken from how I actually plan my exam weeks), testing with my real week, and the demo are my own.

## License

MIT
