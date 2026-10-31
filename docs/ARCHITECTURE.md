# Architecture

## The one idea

The planning rules are plain JavaScript with no dependencies, in `public/core/`. The browser loads those files as ES modules. The Cloudflare Worker imports the same files when it checks the agent's tool calls. There is no build step and no second copy.

So a button press runs on the device: instant, offline, and nothing leaves it. And when the model acts, the same code judges it.

## Map

```
public/
  index.html        markup only
  css/app.css
  js/app.js         screens, accounts, the call, reminders
  js/strings.js     every word, in English and Vietnamese
  js/audio.js       microphone, WAV, a tone
  sw.js             offline shell, push
  core/             pure logic, shared with the Worker
    planner.js      the queue, greedy placement, cuts, debt, learned pace
    invariants.js   the 8 promises as checks
    tools.js        today's tools, each validating its input
    week-tools.js   tools past today: they can only add
    setup.js        weeks: fair daily share, new days, closing a week, hand edits
    radar.js        can each deadline still be met?
    tradeoff.js     which cuts are valid
    diff.js         what changed, computed from two plans
    handlers.js     everything that needs no AI and no account
    sample.js       the sample week
    demo-state.js   the demo day
    replay-*.json   one recorded run, used only if the AI is down during the demo
src/
  worker.js         routes, limits, budget, geographic rules
  agent.js          the agent loop
  council.js        the two guardians
  import.js         reading a syllabus
  voice.js          WebSocket bridge to Muse Voice Transcribe
  models.js         Meta and Baseten behind one call, with failover
  auth.js           Google sign-in, one saved plan per person
  push.js           reminders with no content
scripts/
  simulate.js        100,000 broken days
  simulate-weeks.mjs whole weeks
  mutants.cjs        plants bugs, checks they are caught
  eval.mjs           40 scenarios with real models
  benchmark.js       speed and reliability by reasoning effort
  e2e.mjs            a real browser
  record-replay.mjs  records the demo fallback
  usage-report.mjs   totals from real use, no names
```

## A turn of the agent

```
"I slept through the afternoon, meeting at 7pm"
  │
  ▼
Worker: limits, budget, geography
  │
  ▼
runAgent ── Muse Spark, with the plan and the deadline radar ──┐
  ▲                                                            │ tool call
  │  rejected, with the reason                                 ▼
  └──────────────────────────────────────────────── tools.js checks it
                                                               │ accepted
              the new plan streams to the screen at once  ◄────┤
                                                               │ the day no longer fits?
                                                               ▼
                        tradeoffCandidates: cuts that fit and keep every floor
                                                               │
                         ┌─────────────────────────────────────┤ in parallel
                         ▼                                     ▼
                 Deadline Guardian                      Life Guardian
                         └──────────────┬──────────────────────┘
                                        ▼
                  two cards, or "both agree" plus an alternative
                                        ▼
                  the person decides, by tap or by voice
```

Times measured on the live app for this scenario: the plan changes after about 2 seconds, and the guardians answer after 6 to 8.

## Decisions worth explaining

**Code decides when to ask.** The model does not choose whether something may be cut silently. If the plan no longer fits and the model did not ask, code asks. The planner never cuts on its own.

**The model never sees the cut list.** If it did, it would pick one itself and the advisors would never run. It only says that the day no longer fits.

**Advisors are not forced to disagree.** In testing they often picked the same option. Showing that honestly ("both guardians agree", plus a real alternative) is better than a staged debate.

**A receipt from code.** The model's sentence is only its summary. What changed is computed by comparing the two plans, and shown next to it.

**The agent cannot claim a deadline is safe.** It reads the radar in the plan, and the radar is code. Before this, it would say "it will fit" with nothing behind it.

**Debt is not a schedule.** Missed work is never pushed into a chosen future slot. Each morning, the day takes its fair share of what is open.

**Week tools only add.** Removing work or changing a floor is the person's own action, in the app. That makes prompt injection boring: the worst a fooled model can do is add a task, which is visible, and can be undone.

**Reminders carry no content.** A push is only a signal. The sentence on the notification is fixed in the service worker, so no task name passes through a push service.

## Limits, on purpose

- Plans live in the browser, with a copy in Cloudflare KV for people who sign in. Two devices: the latest save wins.
- KV allows 1,000 writes a day on the free plan, so nothing writes unless something real changed, and the spending counter counts in steps.
- `index.html` no longer has inline scripts, so a strict Content Security Policy is on (`public/_headers`).
- The Worker runs in the US (`wrangler.toml`), because Meta's models are not offered from Hong Kong, where Cloudflare would otherwise route traffic from Vietnam.
