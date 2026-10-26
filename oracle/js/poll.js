// When to fetch /live next (owner t665u): right after the Worker's next cycle lands, instead of
// a blind 30-s poll of /live + /health (4 requests a minute). Pure; main.js owns the timer.
//
// The /live "cycle" hint says when the last cycle started (ts, the cron minute) and how long it
// and the commander took. The next one starts 60 s later and usually takes about as long, so we
// ask AFTER_S seconds after that. If the data hasn't moved yet, retry RETRY_S later, at most
// MAX_RETRY times, then wait for the next minute. Typical: ~1.1-1.3 requests a minute.

export const AFTER_S = 3, RETRY_S = 6, MAX_RETRY = 3, FALLBACK_S = 30, STALE_S = 180;

/**
 * cycle: the /live hint ({ts, ms, age_s, commander_ts}) or null; prevTs: cycle.ts of the last
 * complete fetch (null on the first); retries: retries so far; nowS: page clock (s);
 * wantCmd: a live alert is on, so the commander must have landed too (commander_ts >= ts).
 * Returns {delayS, retries, complete}.
 */
export function nextPoll(cycle, prevTs, retries, nowS, wantCmd = false) {
  if (!cycle || !cycle.ts) return { delayS: FALLBACK_S, retries: 0, complete: true };
  // Worker clock -> page clock (the page's clock may be off): use the hint's age.
  const startS = nowS - (cycle.age_s ?? Math.max(0, nowS - cycle.ts));
  if (nowS - startS > STALE_S) return { delayS: FALLBACK_S, retries: 0, complete: true };   // cron stalled: poll as before
  const cmdIn = !!cycle.commander_ts && cycle.commander_ts >= cycle.ts;
  const complete = (prevTs == null || cycle.ts !== prevTs) && (!wantCmd || cmdIn);
  if (!complete && retries < MAX_RETRY) return { delayS: RETRY_S, retries: retries + 1, complete };
  // How long after its start the last cycle's data was complete (cycle + commander).
  const took = Math.max(Math.ceil((cycle.ms || 0) / 1000), cmdIn ? cycle.commander_ts - cycle.ts + 1 : 0);
  let target = startS + 60 + Math.min(took, 40) + AFTER_S;
  while (target - nowS < 2) target += 60;
  return { delayS: Math.min(75, target - nowS), retries: complete ? 0 : retries, complete };
}
