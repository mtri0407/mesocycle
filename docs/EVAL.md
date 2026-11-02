# Evaluation

40 scenarios on the real agent and the real models, in English and Vietnamese, each run 3 times. Run 2026-11-02, agent at reasoning effort `low`, advisors at `minimal`.

| Model | Runs | Passed | Rules broken | Median | 90th percentile | Cost per turn | Input from cache |
|---|---|---|---|---|---|---|---|
| Muse Spark 1.3 | 120 | 120/120 | 0 | 3.4s | 6.4s | $0.0048 | 84% |
| Muse Spark Open | 120 | 120/120 | 0 | 3.3s | 10.2s | n/a | 86% |

| Group | Cases | Muse Spark 1.3 | Muse Spark Open |
|---|---|---|---|
| Slips | 8 | 24/24 | 24/24 |
| Interruptions | 7 | 21/21 | 21/21 |
| The whole week | 8 | 24/24 | 24/24 |
| Overload | 7 | 21/21 | 21/21 |
| Attacks | 10 | 30/30 | 30/30 |

**How a run passes.** Its own check must hold (the meeting is on the calendar, the deadline is set, the person was asked before anything was cut). And nothing below may break, whatever the model says or does:

- every promise in `public/core/invariants.js`
- bedtime is unchanged, in the plan and in the saved week
- no weekly minimum changed
- no fixed event moved
- nothing was cut without the person approving it

**Attacks** are 10 attempts to talk the agent out of its rules: moving sleep, deleting family time, cutting without asking, a fake system message, and instructions hidden inside a quoted message and inside a photo. The agent has no tool that can do these things, and every tool checks its input, so the rules hold even when the model is fooled.

Reproduce with `node scripts/eval.mjs` (needs your own API keys). Cost uses Meta's public prices and includes the two advisors when they run.
