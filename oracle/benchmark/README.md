# Benchmark — read this first

This folder holds the oracle's scored prediction history
(`benchmark_predictions.jsonl`: predictions and settled outcomes per alert)
and the tooling around it. **Never quote a benchmark mean without
`input_status.json`** — a quarter of the settled rows are a different kind of
alert, scored differently, and two past labelling errors (below) are exactly
what happens when the pools get mixed.

## Files

| File | What it is |
|---|---|
| `benchmark_predictions.jsonl` | The bin itself. Settled rows carry winner + Brier slices (t0/t30/t60). 22 settled lines also carry a `corrupt_input` note — see mismatch 2 before believing that word. |
| `benchmark_predictions.pre-fix-2026-10-20.jsonl` | Byte-identical backup of the bin before the 2026-10-20 notes were appended. |
| `input_status.json` | Per-settled-row status: `clean` / `corrupt` / `unclassified`. Read mismatch 2: "corrupt" currently means Meltdown (relabel pending). |
| `CORRUPT_INPUT_FIX_2026-10-20.md` | The 2026-10-20 fix record: quick guide at the top, full tables below. Its continent names for zones 2/4/6 are rotated — see mismatch 4. |
| `rescore_census.py` / `rescored.json` | Winner rescoring against Census. Does not yet honour the status file (open follow-up). |
| `meltdown_baselines.py` / `meltdown_baselines.json` | Meltdown predictability baselines. |
| `benchmark_log.py` | The logger that wrote the bin (VM era, retired 2026-10-18). |

## Alert structure — the two kinds of alert in this bin

PlanetSide 2 runs two alert types, and this bin mixes them:

| | Standard alert | Unstable Meltdown |
|---|---|---|
| Duration | 90 min | ~45 min (Oshur ~35 min observed) |
| Event IDs in row keys | 147–158, plus Oshur 214 / 222 | 176–193, plus Oshur 248–250 |
| Map | Whole continent in play | Triggered at ~41% territory: everything outside a central region **locks to neutral** for the whole alert |
| Neutral share in snapshots | ~0% (Oshur ~8% constant) | The locked share below, constant |

Locked share per continent, measured from the map-snapshot archive
2026-10-20 (identical set of facilities on every server and day):

| Continent (zone) | Locked neutral |
|---|---|
| Hossin (2) | 47 of 89 facilities (52.8%) |
| Amerish (4) | 54 of 88 (61.4%) |
| Indar (6) | 52 of 81 (64.2%) |
| Esamir (8) | 31 of 51 (60.8%) |
| Oshur (344) | 34 of 75 (45.3%) |

How to recognise a Meltdown in snapshot data: neutral share steps up to the
locked share at minute 0, stays constant, and steps back down at the end.
Facilities inside the playable region keep changing hands normally. A high
neutral share is the alert working as designed — it is **not**, by itself,
evidence of a corrupt feed. (A genuinely corrupt feed looks different:
frozen or winner-takes-all snapshots, e.g. the 2026-10-17 Oshur 96.1/0/0
settlements.)

25 of the 64 settled rows in this bin are Meltdowns.

## Known mismatches — read before quoting numbers

1. **Meltdown rows were scored on diluted shares.** The retired VM engine
   divided territory by *all* facilities including the locked region, so
   during a Meltdown the three faction shares sum to ~100% minus the locked
   share, and the model ran 90-minute math on a 45-minute alert. Those rows'
   Briers are a separate pool — not comparable to standard-alert Briers, in
   either direction. The current Worker engine drops neutral regions before
   computing shares, so this is a VM-era artifact only.
2. **The `corrupt_input` label is wrong (found 2026-10-20).** The 22 rows
   tagged `corrupt_input` in the bin and `corrupt` in `input_status.json`
   are Meltdowns, not corrupt data. The classifier behind the tag measured
   median neutral share over [alert start, settlement time], which mostly
   measures *settlement lag*: Meltdowns settled promptly kept the locked
   share as their median and were tagged; three late-settled Meltdowns were
   diluted by hours of post-alert snapshots and sit in `clean`:
   `1-4-177-1791821154`, `1-8-176-1791797973`, `10-8-186-1791772425`.
   Until the status file is relabelled, read `corrupt` as "Meltdown —
   excluded from headline means (diluted shares)" and treat those three
   `clean` rows as Meltdowns too.
3. **Corrected headline numbers (t30 Brier).** Standard alerts only:
   **0.2073 (n=36)**. Meltdown pool: **0.2194 (n=23)**. The fix doc's
   0.1987 (n=40) and the status file's 0.1981 (n=39) both mix the pools in
   different proportions — neither is the standard-alert figure.
4. **The fix doc's continent names are rotated for zones 2/4/6.** Its
   per-row neutral counts are correct per zone, but the continent names
   attached to zones 2, 4 and 6 are cycled (rows labelled "Hossin" with
   54/88 are zone 4, etc.). Esamir and Oshur rows are correct. Trust the
   zone table above.
5. **Alert IDs recycle.** The same event ID recurs days later; anything
   keyed on alert ID alone will eventually absorb the wrong alert.
   Settlements are keyed by (alertId, endedAt). Census end events land
   +1 s (typical) to +2 s after start+duration, so instance-matching
   tolerances must exceed that (the settlement verifier uses 5 s since
   2026-10-20).
6. **The snapshot archive is not in this repo.** Only one day of one zone
   is committed (`oracle/backend/data/map_snapshots/1/4/2026-10-18.jsonl`).
   The full archive — the ground truth behind every measurement cited
   here — is the VM's `~/workspace/ps2polymarket/data/map_snapshots/
   <world>/<zone>/<date>.jsonl` (2026-10-04 → 2026-10-18). Classifications
   cannot be re-run from this repo alone.

## History in one paragraph

The bin was written by the VM pipeline (retired 2026-10-18; the oracle now
runs on Cloudflare). Winners were rescored against Census on 2026-10-19
(`rescored.json`: 8 winners changed, 5 rows unresolved). On 2026-10-20 the
22 Meltdown rows were tagged `corrupt_input` under the misreading in
mismatch 2, a pre-fix backup was kept beside the bin, and per-row status
was split into `input_status.json`. The benchmark rows themselves have
never been edited — tags and status live alongside them.
