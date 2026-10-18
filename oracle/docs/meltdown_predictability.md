# 45-min Meltdown vs 90-min Standard Alert Predictability

Date: 2026-10-13. Read-only analysis. No benchmark files modified.

## Data availability (the headline finding)

**There are zero 45-min meltdown alerts in the historical dataset.** All 38,651
alerts in `data/alerts/` are 90-min (`duration == 5400000`). The fetch pipeline
(`fetch_alerts.py:66`, `fetch_alerts_v2.py:64`) explicitly filters to 90-min only,
so meltdowns were never collected. The PS2Alerts API is Cloudflare-blocked for
automated access (HTTP 403), so no external meltdown history could be pulled.

A direct meltdown-vs-standard predictability comparison is therefore **impossible
from local data today**. What follows is (a) the 90-min baseline, (b) a proxy
analysis of meltdown-like starting conditions, and (c) a recommendation.

## 90-min baseline: leader-win rate by slice (n=35,770 decisive alerts)

| Slice | Leader wins | n |
|-------|-------------|---|
| t0    | 44.5% | 35,770 |
| t15   | 46.5% | 35,770 |
| t30   | 50.4% | 35,770 |
| t45   | 56.6% | 35,770 |
| t60   | 65.1% | 35,770 |
| t75   | 77.7% | 35,770 |

(Consistent with the 2026-10-11 rank-predictability study.)

## Proxy analysis: do large t0 leads make alerts more predictable?

Unstable Meltdown triggers on a territory threshold (~41%+), so the triggering
faction starts with a large lead. Proxy: 90-min alerts where the t0 leader held
>=41% territory (n=22,601, 63.2% of alerts).

| Slice | Proxy leader wins | Baseline | Delta |
|-------|------------------|----------|-------|
| t0    | 45.2% | 44.5% | +0.7pp |
| t15   | 46.6% | 46.5% | +0.1pp |
| t30   | 50.4% | 50.4% | +0.0pp |
| t45   | 56.4% | 56.6% | -0.2pp |
| t60   | 65.0% | 65.1% | -0.1pp |
| t75   | 78.0% | 77.7% | +0.3pp |

**A large t0 territory lead adds essentially zero predictability.** Leader-win
rates are virtually identical at every slice.

Leader-win rate by t0 lead margin confirms it:

| t0 lead margin | Leader wins | n |
|----------------|-------------|---|
| 0–5pp  | 41.9% | 8,472 |
| 5–10pp | 45.2% | 10,439 |
| 10–15pp| 43.6% | 10,542 |
| 15–20pp| 47.2% | 3,721 |
| 20–25pp| 48.6% | 1,203 |
| 25–30pp| 50.1% | 579 |
| 30–35pp| 55.1% | 350 |

Even a 30–35pp t0 lead only reaches a 55% win rate. Early territory gaps are
weak predictors — consistent with the earlier finding that a 10%+ gap at t30
leaves the leader finishing last ~50% of the time.

## What the proxy cannot test

The proxy uses 90-min alerts. It cannot test the **duration effect itself**:
a 45-min alert gives the field half the comeback time of a 90-min alert.
Whether shorter duration independently raises predictability is unknown and
requires real meltdown data.

Caveat: real meltdowns also differ in player behavior (the triggering faction
is actively snowballing; defenders may give up). The proxy captures the
starting-lead mechanism only.

## Historical meltdown frequency / continent concentration

Cannot be answered from local data (zero meltdowns collected). Live observation:
recent meltdowns seen on world 10 (Wainwright) Hossin (10-4-191, 45-min). Frequency and
continent/server concentration need the collection fix below.

## Recommendation

1. **Separate benchmark pools** for 45-min meltdowns vs 90-min standards
   (duration-tagged). Do not pool their Brier scores — the alert types differ
   structurally (trigger condition, duration, player behavior), and pooling
   would confound the benchmark.
2. **Duration-normalized slices**: 90-min → t0/t30/t60; 45-min → t0/t15/t30
   (same 0%/33%/67% fractions). t40/t45 rejected: t45 is the final whistle,
   t40 is 89% through (no prediction value).
3. **Do not assume meltdowns are more predictable.** The proxy evidence says
   large starting leads add ~zero predictability. The duration effect is
   untested — treat it as an open question, not a prior.
4. **Start collecting meltdowns**: relax the `duration == 5400000` filter in
   `fetch_alerts.py` / `fetch_alerts_v2.py` (or add a parallel meltdown
   collection). Tag every benchmark alert with duration.
5. **Decision gate**: once ~50+ real meltdowns are collected, compare their
   t15/t30 leader-win rates against the 90-min t30/t60 baselines (50.4% /
   65.1%). If meltdown t30 ≈ 65%+, the duration effect is real and the pools
   must stay separate permanently. If meltdown t15/t30 ≈ 50%/65%, consider
   whether duration-normalized pooling is justified — but keep the duration
   tag regardless.

## Files

- `meltdown_proxy_analysis.py` — proxy analysis script (read-only over dataset)
- `meltdown_proxy_results.json` — numeric results
- `meltdown_predictability.md` — this report
