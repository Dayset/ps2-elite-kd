# Unstable Meltdown baselines (issue #11)

Data: the 24 Meltdowns in `oracle/benchmark/rescored.json` (all 45-min, Census winners from #5), each with its Census `world_event` **started** row.
Script: `oracle/benchmark/meltdown_baselines.py`. Raw numbers: `oracle/benchmark/meltdown_baselines.json`.
Brier = mean over VS/NC/TR of (p − outcome)²; coin flip = 0.2222. SE = standard error of the mean over alerts.

| Baseline | n | Mean Brier | SE | Paired vs uniform (mean ± SE) |
|---|---|---|---|---|
| (a) Uniform 1/3 | 24 | 0.2222 | 0 | — |
| (b) Start-row leader wins with p (p fitted leave-one-out) | 24 | 0.2411 | 0.0130 | +0.0189 ± 0.0130 (worse) |
| (c) Proportional to start-row scores | 24 | **0.2188** | 0.0159 | −0.0034 ± 0.0159 (about the same) |
| (d) Our model t0 | 24 | 0.2297 | 0.0170 | +0.0075 ± 0.0170 (about the same) |

What the start rows show:
- The start-row leader was unique in 22 of 24 alerts and won only 9 of those 22 (41%). That is close to the 33% you would get by picking a faction at random, and inside the noise for n = 22.
- Fitted on all 24, the best p for (b) is 0.46, barely above 1/3. Leave-one-out, it loses to uniform.

## Recommendation

- **None of these baselines beats the coin flip by more than the noise.** Proportional (c) is the only one below 0.2222, by 0.003. Its standard error is 0.016, five times larger than that gap, so this is not evidence of skill.
- For now, show **uniform 1/3** (or the model's odds pulled most of the way toward 1/3) on Meltdown alerts, and keep the "not validated for this alert type" note. That guarantees 0.2222 instead of the model's 0.230.
- Keep collecting. With an SE around 0.016 at n = 24, an improvement of about 0.01 needs roughly 4–9× more alerts (100–200 Meltdowns) before it shows. Recheck (c) and a Meltdown-specific model once the benchmark has that many.
- No Worker or tree changes were made (analysis only).
