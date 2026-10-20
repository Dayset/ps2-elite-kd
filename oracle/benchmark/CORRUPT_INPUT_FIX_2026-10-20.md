# Benchmark input status: quick guide for agents

Read this first. The long record below is for history; this section is what to do.

## 1. Which rows count in headline numbers?

Use `oracle/benchmark/input_status.json` (one entry per settled alert):

| status | meaning | include in headline means? |
|---|---|---|
| `clean` | standard alert, healthy map | yes |
| `meltdown` | Unstable Meltdown / Oshur alert: locked share scored as diluted shares (issue #47) | **no** (separate pool) |
| `unclassified` | no start time in the key, cannot measure | no, until checked |

Counts today: 36 clean, 25 meltdown, 3 unclassified (64 settled rows).

## 2. Examples to follow

Mean t30 Brier over clean rows only (Python). The Brier numbers sit on the settled row (`type == "settled"`) under `brier`, keyed by slice:

```python
import json
rows = [json.loads(l) for l in open("oracle/benchmark/benchmark_predictions.jsonl") if l.strip()]
status = json.load(open("oracle/benchmark/input_status.json"))["rows"]
settled = [r for r in rows if r.get("type") == "settled"]
clean = [r["brier"]["t30"] for r in settled
         if status.get(r["alert"], {}).get("status") == "clean" and r["brier"].get("t30") is not None]
print(round(sum(clean) / len(clean), 4), len(clean))  # 0.2073 over 36 standard alerts (issue #47). Meltdowns are a separate pool: 0.2194 over 23.
```

Same with `jq`:

```sh
jq -r '.rows | to_entries[] | select(.value.status == "clean") | .key' oracle/benchmark/input_status.json | head
```

When you add a new settled row, add its status too. Do not edit the benchmark rows to do it.

## 3. Rules

- Never delete or edit a benchmark row to change its status. The `corrupt_input` field is the only in-row marker, and it is kept as is (its name is historical; the rows are Meltdowns).
- Keep `benchmark_predictions.pre-fix-2026-10-20.jsonl` as the restore source.
- If you can't measure a row, mark it `unclassified`. Don't guess `clean`.
- Say which status set you used whenever you quote a benchmark number.

## 4. Answered: these are Meltdowns (issue #47)

The 22 tagged rows, and three late-settled rows that were first read as clean, are **Unstable Meltdowns** (event ids 176–193, Oshur 248–250). In a Meltdown most of the continent locks to neutral by design, so the retired VM engine divided shares by a diluted total. The feed was not corrupt. Status is `meltdown` in `input_status.json`; `exclude_from_headline` is true. Detail: `oracle/benchmark/README.md`, mismatches 1–4.

Corrected headline pools (t30 Brier): standard alerts 0.2073 (n=36), Meltdowns 0.2194 (n=23). The 0.1981 and 0.1987 figures above mix the pools; do not quote them.

## 5. Data gap

The snapshot archive behind these measurements is **not in this repo** (only `oracle/backend/data/map_snapshots/1/4/2026-10-18.jsonl`). It lives on the VM at `~/workspace/ps2polymarket/data/map_snapshots/`. The `clean` labels for standard alerts come from the fix doc and cannot be re-run here.

---

# Benchmark fix 2026-10-20 — tagging the corrupt-input rows (full record)

> **Superseded label (issue #47):** the rows below are Unstable Meltdowns, not corrupt data. Read "corrupt" in this record as "Meltdown, excluded from headline means". The tables' continent names were corrected to match the zone table in `oracle/benchmark/README.md`.


**What this is:** the full description of the 2026-10-20 fix to
`oracle/benchmark/benchmark_predictions.jsonl`. Twenty-two settled benchmark
rows that were scored on a corrupt Census map feed are now tagged in place
with a `corrupt_input` field. No row was deleted, no winner was changed, no
Brier score was edited. This document is the record of what was wrong, how
the rows were found, exactly which rows they are, and what the tag means for
anyone quoting benchmark numbers from this file.

## TL;DR

- During short alerts (34–52 min: Unstable Meltdowns and Oshur alerts),
  Census's map feed served a **fixed, zone-specific subset of facilities as
  neutral (owner 0) for the entire alert**, starting within ~2 minutes of
  the alert start.
- The retired VM pipeline computed territory shares by dividing by **all**
  facilities, neutral included. On corrupt input the three factions' shares
  summed to ~39–55% instead of ~100%, and the prediction tree, the
  commander, and the benchmark all consumed that diluted, off-distribution
  input.
- The winners recorded in these rows are not the problem (settlements were
  verified independently — see "What this fix does not change"). The damage
  is to the **scores**: each affected row's Brier slices measure the data
  feed, not the model. Left untagged, the corrupt third of the bin dragged
  the headline t30 Brier from 0.199 (clean rows) to 0.212 (all rows) in the
  current file, and corrupt rows account for the worst t30 scores in the bin
  (0.6667, 0.5129, 0.5042, 0.4258).
- The live product is **not** affected: the Cloudflare Worker already drops
  neutral regions before computing shares (`liveZone()` in
  `oracle-worker/src/engine.js`) and flags `neutral_heavy` on its own
  settlement records. This fix is benchmark hygiene only.

## Background

The corruption was first seen live on 2026-10-15 (Connery Esamir: 31 of 51
facilities neutral, territory summing far below 100%). An audit on
2026-10-16 of the 45 settled alerts then in the bin found the pattern was
systematic, not one-off: **16 of the 42 classifiable rows had run corrupt —
all of them short alerts, and no long alert was corrupt** — and the neutral
set was identical per zone across servers and days
(the same 54 Amerish region ids on Miller Oct 16 and Connery Oct 14;
31 regions on Esamir). Three of the 45 rows (the oldest: `10-6-244`,
`10-2-149`, `10-6-157`) carry no start timestamp in their key and could not
be classified; they are long-alert era rows and are not tagged.

The VM pipeline that produced this file was retired on 2026-10-18 when the
Oracle moved to Cloudflare. The VM's own copy of the bin
(`~/workspace/ps2polymarket/benchmark_predictions.jsonl`, frozen
2026-10-18 00:34 UTC) is the historical record and was **deliberately left
untouched** by this fix. The fix applies to this repository's copy — the
one that lives on the Oracle GitHub page — which is identical to the VM
copy except it predates the final VM-era settled row
(`1-8-151-1792296111`, a healthy 90-minute alert, absent here).

On 2026-10-20 Dayset asked for the audit-era 16 rows to be rechecked
("they might be done already"). They were not: neither copy of the bin
carried any tag, and the 2026-10-19 Census rescore (`rescored.json`,
issue #5) corrected winners only — it never flagged corrupt input, and
both blowup rows keep their exact corrupt Brier scores there. Dayset then
directed this fix.

## How the rows were identified (method)

Reproduced from primary data on 2026-10-20, independently of the original
audit's notes:

1. For every settled row in this file whose key carries a start timestamp
   (`world-zone-event-startts`), take the alert window
   `[startts, settled ts]`.
2. From the map-snapshot archive
   (`data/map_snapshots/<world>/<zone>/<day>.jsonl`, one snapshot ~every
   60 s, owner codes per facility, `0` = neutral), compute each snapshot's
   neutral share = neutral facilities / total facilities.
3. Take the **median** neutral share across the window. Corrupt rows sit at
   **45.3–64.2%**; every other classifiable row sits at **≤8.0%**. The gap
   is the classification — there are no borderline rows. (A 20% threshold
   was used; any threshold between 9% and 45% selects the identical set.)
4. Cross-checks against the 2026-10-16 audit: the audit-era subset
   (settled on or before the audit, 2026-10-16 15:45 UTC) yields **exactly
   the same 16 rows**, with the same neutral band (45–64%) and the same
   duration band (this measurement: 45.6–51.2 min windows; Oshur rows
   34–35 min). Per-zone neutral counts reproduce the audit's fixed sets
   exactly: Amerish 54/88, Esamir 31/51, Oshur 34/75, Hossin 47/89,
   Indar 52/81.
5. The full file was then classified the same way. Six further rows with
   the identical signature were settled **after** the audit (Oct 16–18,
   including the known 2026-10-17 Oshur corruption, `1-344-248-1792262962`)
   and are tagged in the same pass, listed separately in Table B so the two
   groups are never confused.

The mechanism behind Census serving a fixed neutral subset on short alerts
is still unknown. The pattern is empirical: in this file, all 22 corrupt
rows are short alerts and 0 of 36 classifiable long alerts are corrupt.
Shortness alone is not the tag, though — 3 of the 25 short rows measured
healthy (0.0–3.9% neutral); every tag above rests on the measured neutral
share, not on the alert type.

## The change

Each of the 22 settled rows gained one field, appended to its existing
JSON object (line count, key order, winners, Brier values and every other
line of the file are byte-identical to before):

```json
"corrupt_input": "2026-10-20: alert ran on a corrupt Census map feed — a fixed subset of facilities reported neutral for the whole alert (median 61.4% neutral, 54/88 facilities, measured from the map-snapshot archive). The retired pipeline divided territory shares by all facilities including neutral, so the win% inputs behind this row were diluted (faction shares summing to ~38.6%). The Brier slices measure the feed, not the model: exclude this row from headline benchmark means. Full description: oracle/benchmark/CORRUPT_INPUT_FIX_2026-10-20.md"
```

(The percentages and facility counts in each row's text are that row's own
measured values.)

**Rule for consumers:** a settled row carrying `corrupt_input` stays in the
file for the record, but must be excluded from headline benchmark means
(the same treatment as the `corrected` notes already in this file, which
flag rows whose winners came from PS2Alerts corrections).

## Backup and restore source

Per Dayset's standing rule (2026-10-20): work on corrupted data never
throws the original away — the fixed version carries a backup of what it
was restored from. The pre-fix file is preserved next to the fixed one:

- **`oracle/benchmark/benchmark_predictions.pre-fix-2026-10-20.jsonl`** —
  byte-identical to the file as it stood immediately before this fix
  (41,751 bytes, 247 lines, no `corrupt_input` fields). Restoring is a
  copy back over `benchmark_predictions.jsonl`.
- The same pre-fix content also exists in git history (blob at commit
  `296503b5`, the tip immediately before fix commit `c18cfed3`), and the
  frozen VM copy at `~/workspace/ps2polymarket/benchmark_predictions.jsonl`
  holds the same rows plus the final VM-era settled row that this
  repository copy predates.

## Table A — the 16 rows from the 2026-10-16 audit

| Alert key | Server | Continent | Event | Start (UTC) | Duration | Neutral (median) | Winner | Brier t0 | Brier t30 |
|---|---|---|---|---|---|---|---|---|---|
| `10-4-191-1791859791` | Miller | Amerish | 191 | Oct 13 | 50 min | 54/88 (61.4%) | NC | 0.1681 | 0.0216 |
| `1-2-189-1791879285` | Connery | Hossin | 189 | Oct 13 | 51 min | 47/89 (52.8%) | TR | 0.3093 | 0.5129 |
| `10-2-179-1791881992` | Miller | Hossin | 179 | Oct 13 | 50 min | 47/89 (52.8%) | TR | 0.3148 | 0.3401 |
| `10-344-250-1791885324` | Miller | Oshur | 250 | Oct 13 | 34 min | 34/75 (45.3%) | TR | 0.3393 | — |
| `1-4-177-1791901602` | Connery | Amerish | 177 | Oct 13 | 48 min | 54/88 (61.4%) | NC | 0.1316 | 0.0000 |
| `1-8-186-1791923044` | Connery | Esamir | 186 | Oct 13 | 46 min | 31/51 (60.8%) | TR | 0.2981 | 0.1285 |
| `1-344-249-1791926376` | Connery | Oshur | 249 | Oct 13 | 35 min | 34/75 (45.3%) | VS | 0.0795 | — |
| `10-6-192-1791947560` | Miller | Indar | 192 | Oct 14 | 47 min | 52/81 (64.2%) | TR | 0.1956 | 0.3323 |
| `1-4-177-1791965908` | Connery | Amerish | 177 | Oct 14 | 46 min | 54/88 (61.4%) | TR | 0.2418 | 0.6667 |
| `1-8-176-1791987229` | Connery | Esamir | 176 | Oct 14 | 46 min | 31/51 (60.8%) | NC | 0.1720 | 0.0000 |
| `1-2-189-1792009010` | Connery | Hossin | 189 | Oct 14 | 48 min | 47/89 (52.8%) | TR | 0.2996 | 0.4258 |
| `10-8-176-1792035065` | Miller | Esamir | 176 | Oct 15 | 48 min | 31/51 (60.8%) | VS | 0.1353 | 0.2663 |
| `10-2-179-1792057024` | Miller | Hossin | 179 | Oct 15 | 47 min | 47/89 (52.8%) | TR | 0.3425 | 0.3285 |
| `1-4-187-1792057809` | Connery | Amerish | 187 | Oct 15 | 49 min | 54/88 (61.4%) | TR | 0.2228 | 0.0000 |
| `1-8-186-1792096022` | Connery | Esamir | 186 | Oct 15 | 48 min | 31/51 (60.8%) | VS | 0.1793 | 0.3748 |
| `10-4-191-1792126655` | Miller | Amerish | 191 | Oct 16 | 47 min | 54/88 (61.4%) | VS | 0.2472 | 0.5042 |

## Table B — 6 further rows, same signature, settled after the audit

| Alert key | Server | Continent | Event | Start (UTC) | Duration | Neutral (median) | Winner | Brier t0 | Brier t30 |
|---|---|---|---|---|---|---|---|---|---|
| `1-2-179-1792183418` | Connery | Hossin | 179 | Oct 16 | 46 min | 47/89 (52.8%) | TR | 0.2920 | 0.2039 |
| `10-4-177-1792210482` | Miller | Amerish | 177 | Oct 17 | 50 min | 54/88 (61.4%) | NC | 0.1316 | 0.0056 |
| `1-2-193-1792235327` | Connery | Hossin | 193 | Oct 17 | 51 min | 47/89 (52.8%) | TR | 0.2122 | 0.2563 |
| `1-6-178-1792258726` | Connery | Indar | 178 | Oct 17 | 51 min | 52/81 (64.2%) | VS | 0.2046 | 0.0850 |
| `1-344-248-1792262962` | Connery | Oshur | 248 | Oct 17 | 35 min | 34/75 (45.3%) | NC | 0.4103 | 0.0000 |
| `10-4-177-1792294792` | Miller | Amerish | 177 | Oct 18 | 50 min | 54/88 (61.4%) | VS | 0.1291 | 0.3295 |


## Effect on the headline numbers (this file, 64 settled rows)

| Slice | All rows | Clean rows only (42) | Corrupt rows (22) |
|---|---|---|---|
| t0 | 0.2237 (n=64) | 0.2204 (n=42) | 0.2298 (n=22) |
| t30 | 0.2121 (n=60) | **0.1987 (n=40)** | 0.2391 (n=20) |
| t60 | 0.1368 (n=35) | 0.1368 (n=35) | — (short alerts never reach t60) |

Read: t30's bad reputation in this bin is mostly the feed. Clean-only t30
(0.1987) is still worse than t60 (0.1368) — tagging the rows reframes the
number, it does not flatter the model. t0 barely moves: at alert start the
tree has no strong view yet, so there was little signal for the corruption
to destroy.

## What this fix does not change

- **No winners were edited.** Settlement correctness was established
  separately: the two worst blowups (`1-8-186-1792096022`, t30 0.3748;
  `10-4-191-1792126655`, t30 0.5042) both settled the Census-correct winner
  (VS), and the 2026-10-19 rescore re-checked every settled winner against
  Census final scores (8 winners corrected there — a disjoint concern;
  one row, `1-6-178-1792258726`, appears in both lists: its input was
  corrupt *and* its bin winner was later corrected by the rescore).
- **No payouts were affected.** These are benchmark rows from the retired
  VM pipeline; live betting settles in the Worker, which never had the
  dilution bug.
- **`rescored.json` was not regenerated.** It is the output of
  `rescore_census.py`, which does not yet skip `corrupt_input` rows; its
  meltdown aggregates still include them. Teaching the rescore to honour
  the tag is a follow-up, not part of this change.
- **The VM bin was not modified** (see Background).

## Verification

- Classification rerun from the snapshot archive on 2026-10-20 reproduces
  the audit's 16/16 with matching neutral percentages and durations, and
  the per-zone neutral counts match the fixed sets recorded in October
  where those were recorded (Amerish 54, Esamir 31, Oshur 34).
- After tagging: the file still has 247 lines; the diff touches exactly
  the 22 settled lines, each gaining only the `corrupt_input` field; all
  22 edited lines parse as JSON and every untouched line is byte-identical
  to the pre-fix file.
