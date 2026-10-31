# Muse Spark vs Muse Spark Open

Same agent, tools and rules; 10 scenarios in English and Vietnamese on the demo day. Run 2026-10-31.

| Model | Runs | Task done, rules kept | No rejected call | Median model calls | Median time |
|---|---|---|---|---|---|
| Muse Spark 1.3 | 20 | 18/20 (90%) | 20/20 (100%) | 3 | 9.9s |
| Muse Spark Open | 20 | 19/20 (95%) | 20/20 (100%) | 3 | 9.6s |

A run counts as done when the requested change is in the plan, the agent finished on its own, and every planner promise in src/invariants.js still holds.

All 3 misses were the same scenario: at 20:00, "skip the law slides tonight". Instead of marking the item skipped, the agent proposed moving it to debt and waited for approval. No rule was broken, but the user had already decided, so we count it as not done. Every other scenario passed on both models, and no run had a tool call rejected.

Reproduce: `node scripts/benchmark.js meta,open` (needs keys in `.dev.vars`; about 40 model calls).
