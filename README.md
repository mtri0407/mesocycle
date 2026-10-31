# Mesocycle

**Your day broke. Say what happened.**

Other AI calendars optimize your work. Mesocycle protects what must not be sacrificed: your sleep, your people, your health.

Built for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Indie track, theme: Build for Your World), October 27 to November 4, 2026.

**Try it:** https://mesocycle.minhtriphamnguyen69.workers.dev (press *Try it in 60 seconds*, no sign-in)

*A mesocycle is a planned block of weeks, built around how you really recover. This is that, for your life.*

## The problem

I'm a first-year IT student who also runs a small education company. I plan every day in blocks. Then reality happens: I start 40 minutes late, a block takes twice as long, a meeting appears at 7pm. In a calendar where every task has a fixed time, one slip pushes everything after it, and by evening the whole day has collapsed.

I built a planner with an automatic "reschedule" button before this hackathon, and I stopped using it. It needed setup, it guessed where to put missed work in a future that hadn't happened yet, and it treated every minute as equal. What actually worked was talking the plan through with an AI. Mesocycle is that conversation, with memory of my week and rules that cannot be broken.

## Three moments

**Call it.** Press Call AI and talk, hands-free. "I slept through the afternoon, and there's a class meeting at 7pm." The meeting lands on your timeline about 2 seconds later, while the agent is still working, and the rest of the day slides around it.

**Two guardians.** When something has to give, two advisors weigh it at the same time. The Deadline Guardian defends your exams. The Life Guardian defends your health and your people. Each picks one option and says why, you choose by voice or by tap, and nothing is cut until you do. If they agree, the app says so; they are never made to disagree.

**It cannot break the rules.** The model never edits your plan. It calls tools, code checks every call, and every answer comes with a receipt written by code, not by the model: what moved, what was refused, and 8 of 8 promises holding.

## What you can do

| | |
|---|---|
| **Set up your week in a minute** | Describe it in your own words, typed or spoken, English or Vietnamese. Add a photo of your timetable. |
| **Follow one card: Now** | Done, need 15 more minutes, or can't do it. The rest of the day slides on an animated timeline. |
| **Call the agent** | It adds work with a deadline, one-time and weekly events and goals, remembers the conversation, and takes "option 2" as your answer. |
| **Add a syllabus** | Drop a PDF or a photo. Muse Spark finds every date, you tick what to keep, and the radar shows which deadline is in trouble. |
| **Bring your calendar** | Add an `.ics` file from any calendar app. It is read on your device, and you choose what to keep. |
| **See deadlines coming** | The radar works out, in code, which deadlines can still be met and how many hours are missing. The agent has to read it, so it cannot just say "you'll be fine". |
| **Connect it to your goals** | Goals link to the roles that serve them, show the hours they got this week, and warn when they fall behind pace. |
| **Close the loop every week** | A new week closes the old one: plan against reality, debt carried over. Muse Spark proposes next week's hours with a reason for each. Nothing applies until you approve it. |
| **Trust it** | Undo anything the AI changed. Edit anything by hand. Estimates learn how long things really take you, and say so. |
| **Share your week** | A picture of your hours and kept minimums, never your task names. |
| **Keep going offline** | Planning runs on your device, so everything except the AI works with no connection. |
| **Choose where your words go** | *More private* runs on Muse Spark Open through Baseten instead of Meta. |

Not ready to set up? *See a sample week* shows goals, history and the trend chart in seconds.

## Why not Motion, Reclaim or Google Calendar?

Motion and Reclaim are serious products, and by their own descriptions they also move work when plans change: Motion "recalculates your schedule when plans change", and Reclaim "dynamically adapts meetings, tasks, and focus time". The differences below are design choices in Mesocycle, checked against this repository; I have not tested those products in depth.

| Mesocycle's choice | Why |
|---|---|
| Today only: flexible work is a queue, and later days are never filled in advance | Missed work becomes debt instead of a guess about a future that has not happened |
| Weekly floors are hard rules in code | Family or health cannot silently lose to work; a cut that breaks a floor is rejected |
| Two advisors argue the hard choices, and you decide | A trade-off in your life should be shown to you, not optimized away |
| You describe a broken day in one sentence, by voice | No dragging blocks around when you are already behind |
| The AI can only call checked tools, and every step is shown | 40 of 40 scenarios passed, 10 attacks included, 0 rules broken |
| Sleep is never moved by the agent, and at most 60% of free time is planned | The plan assumes real life happens |
| Open source, and runs on open weights too | The same agent passes the same tests on Muse Spark Open |

Google Calendar stores the events you put in it; re-planning a broken day is left to you.

## How it works

```mermaid
flowchart TB
  subgraph Device["Your device"]
    UI["Screens, voice, camera"]
    Core["Planning core: planner, 8 promises, deadline radar, cut candidates"]
    UI --> Core
  end
  subgraph Worker["Cloudflare Worker: holds the keys"]
    Agent["Agent loop"]
    Council["Two advisors, in parallel"]
    Tools["Same planning core: checks every tool call"]
    Agent -->|tool call| Tools
    Tools -->|rejected, with the reason| Agent
    Agent --> Council
  end
  UI -->|only when you use the AI| Agent
  Agent <--> Spark["Muse Spark 1.3"]
  Agent <-.->|private mode, or if Meta fails| Open["Muse Spark Open on Baseten"]
  UI <-->|live audio, through the Worker| Voice["Muse Voice Transcribe"]
```

- **Only fixed events have hard times** (classes, exams, meetings, sleep). Flexible work is an ordered queue that slides when you're late, so a slip never cascades.
- **Missed work becomes debt**, not a guess about tomorrow. It comes back when there is real free time.
- **Weekly floors protect your life.** Mesocycle never offers a cut that pushes a role under its weekly minimum while the rest of the week cannot make up for it.
- **Each day takes its fair share** of each role's work, in proportion to the free time left this week, and at most 60% of free time is planned. The rest absorbs meals, transitions and the unexpected.
- **It only asks when it must.** Small slips are handled silently. If the model forgets to ask when something no longer fits, code asks instead.

### One planning core, two places

The planner, its rules and the tools live in [`public/core/`](public/core). The browser loads those files directly, so a button press is instant, works offline and sends nothing. The Worker imports the very same files to check the agent's tool calls. There is no build step and no second copy, so the two can never disagree. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### The agent and the guardrails

The agent has six tools for today (`get_state`, `add_fixed`, `add_item`, `update_item`, `reorder`, `propose`) and, on a real week, `add_task`, `add_event`, `add_goal` and `accept_proposal`. Every call is validated in code. A rejected call returns the reason, the model reads it and corrects itself, and the app shows these ✗ and ✓ steps as they happen. No tool can remove work, touch sleep or lower a floor, so a fooled model still cannot do damage.

The two guardians ([`src/council.js`](src/council.js)) get no tools at all. Code first works out which cuts fit and keep every floor ([`public/core/tradeoff.js`](public/core/tradeoff.js)); the guardians can only choose among those, and an invented option is dropped. They start as soon as code knows a cut is needed, in parallel with the main agent. If they fail, the cuts code would offer on its own still reach you.

## How it uses Meta's models

| Job | Model | How |
|---|---|---|
| Planning agent | `muse-spark-1.3` | Tool calling with parallel calls, `reasoning_effort: low`, `prompt_cache_key` so the stable prefix is cached |
| The two guardians | `muse-spark-1.3` | Two parallel calls, `reasoning_effort: minimal`, strict `json_schema` output, no tools |
| Same agent on open weights | `muse-spark-open-1026` on Baseten | Private mode, and automatic failover if Meta is unavailable |
| Live speech to text | `muse-voice-transcribe-1.0` | Realtime WebSocket through the Worker, which holds the key. `languageBias` for Vietnamese and English, `keywords` from your own plan so names are heard correctly |
| Hands-free call | `muse-voice-transcribe-1.0` | `ENDPOINTING` mode: `speechComplete` marks the end of each turn, silence is streamed while the AI talks so it never hears itself |
| Reading a timetable or a message | `muse-spark-1.3`, or Muse Spark Open in private mode | Image understanding |
| Reading a syllabus | `muse-spark-1.3` | PDF input with strict `json_schema` output |
| Next week's proposal, morning check-in | `muse-spark-1.3` | Checked tool call; read-only summary |

**Why two models.** Not for show. Baseten states it does not keep or train on these requests, which is the honest reason for a private mode. And if Meta fails, Muse Spark Open answers within the same turn, so one outage does not stop the app.

**Speech out.** Meta has no speech output model, so answers are read by the voice built into your device.

## Evaluation

40 scenarios on the real agent and real models, English and Vietnamese ([docs/EVAL.md](docs/EVAL.md), `npm run eval`):

| Model | Runs | Passed | Rules broken | Median | 90th percentile | Cost per turn |
|---|---|---|---|---|---|---|
| Muse Spark 1.3 | 40 | 40/40 | 0 | 3.3s | 7.5s | $0.0051 |
| Muse Spark Open | 40 | 40/40 | 0 | 3.7s | 7.8s | n/a |

10 of the 40 are **attacks**: moving sleep, deleting family time, cutting without asking, a fake system message, and instructions hidden in a quoted message and in a photo. None got through.

Lowering reasoning effort and ending the turn at the proposal took a typical turn from 9.9 seconds to about 3, with no drop in score ([docs/BENCHMARK.md](docs/BENCHMARK.md)).

## Stress tests

The promises are written as code in [`public/core/invariants.js`](public/core/invariants.js): never plan into sleep, never move a fixed event, never let a task silently disappear, never fill more than the limit, never cut without asking, never go under a floor silently. The app runs these on your device after every change.

```
npm run simulate         100,000 broken days, 994,609 re-plans. Broken promises: 0
npm run simulate:weeks   70,000 days of whole weeks: 9,644 weeks closed, 29,566 hand edits,
                         31,572 agent additions, 109,208 deadline checks. Broken promises: 0
```

The whole-week simulator earned its place by finding a real bug in the deadline radar during development. And to test the tests, `node scripts/mutants.cjs` plants 6 bugs one at a time: every one is caught.

104 unit tests run with no model calls (`npm test`), and `npm run e2e` drives a real browser: offline use, no network during planning, the demo surviving the AI being down.

## When things go wrong

- **Meta fails:** Muse Spark Open takes over within the turn.
- **Both fail during the guided demo:** a recording of one real run plays, and says that it is a recording.
- **KV storage is full:** the AI keeps working; saving shows a warning and retries.
- **Too many people on one network:** limits are per person, with a loose limit per network.
- **Budget:** past a daily ceiling, requests move to the open model instead of failing.

## Privacy

Planning runs on your device. Your plan leaves it only when you use the AI, or when you sign in to save it. See the [privacy policy](https://mesocycle.minhtriphamnguyen69.workers.dev/privacy) and [terms](https://mesocycle.minhtriphamnguyen69.workers.dev/terms). You must be 18 or older, and you can delete your data from the app. The AI is not offered in the territories restricted by Meta's geographic policy.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # put your keys in .dev.vars
npm test                         # 104 tests, no model calls
npm run simulate                 # the stress test
npm run dev                      # open http://localhost:8787
npm run e2e                      # browser checks (needs wrangler dev on port 8799)
```

Runs on Cloudflare Workers. Keys are read from environment variables (`MODEL_API_KEY`, `BASETEN_API_KEY`); `.dev.vars` is git-ignored and in production they are Cloudflare secrets.

## Boundaries

Mesocycle is a time-planning tool. It gives no medical, mental health, nutrition or training advice. If you say you're tired or stressed, it only asks how much time you have today.

## Built during the hackathon

Everything in this repository was written during the hackathon (first commit: October 27, 2026); the daily history is in the commits and in `docs/dev-notes/`. My earlier planner app was not reused; Mesocycle is new code, designed from what that app taught me.

AI coding assistants were used during development. The product decisions, the rules (taken from how I actually plan my exam weeks), testing with my real week, and the demo are my own.

## License

MIT
