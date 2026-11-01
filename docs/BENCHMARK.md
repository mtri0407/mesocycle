# Muse Spark vs Muse Spark Open

Same agent, tools and rules; 10 scenarios in English and Vietnamese on the demo day. Run 2026-10-31, reasoning effort low.

| Model | Runs | Task done, rules kept | No rejected call | Median model calls | Median time | Slowest |
|---|---|---|---|---|---|---|
| Muse Spark 1.3 | 20 | 20/20 (100%) | 20/20 (100%) | 2 | 3.1s | 4.6s |
| Muse Spark Open | 20 | 20/20 (100%) | 20/20 (100%) | 3 | 4.5s | 6.7s |

A run counts as done when the requested change is in the plan, the agent finished on its own, and every planner promise in `public/core/invariants.js` still holds.

## Before tuning

The same 10 scenarios, run earlier on 2026-10-31 with the models' default reasoning effort and without stopping the turn after a proposal (commit `ebd71ea`):

| Model | Runs | Task done, rules kept | No rejected call | Median model calls | Median time |
|---|---|---|---|---|---|
| Muse Spark 1.3 | 20 | 18/20 (90%) | 20/20 (100%) | 3 | 9.9s |
| Muse Spark Open | 20 | 19/20 (95%) | 20/20 (100%) | 3 | 9.6s |

All 3 misses were the same scenario: at 20:00, "skip the law slides tonight". Instead of marking the item skipped, the agent proposed moving it to debt and waited for approval. No rule was broken, but the user had already decided, so it counted as not done.

Reproduce: `node scripts/benchmark.js meta,open` (needs your own API keys).
