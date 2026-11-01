// Server crash / shutdown mid-alert (owner t818s2880).
//
// A timed alert that ends well before its planned length AND whose server goes down or
// silent right after was cut short by the server, not won: status "interrupted", no
// winner, votes given back, left out of the accuracy/benchmark stats and of training.
// An early end on a server that keeps running (e.g. Osprey 1-6-49426, 80 of 90 min,
// captures 2 min later) settles as normal with an "ended_early" flag.
//
// Thresholds, from real data (PS2Alerts, Apr 2024 - Oct 2026, 4,997 finished territory alerts):
//  - 4,985 ended within 30 s of their planned length, 2 more within 2 min; only 10 ended
//    3+ min early -> EARLY_END_S = 3 min.
//  - Of those 10, the server crashes / shutdowns were followed by 13-90 min with no
//    capture anywhere on that server; the 3 where the server stayed up had their next
//    capture 2-6 min after the end, and the longest quiet spell in the 30 min before any
//    end was 9 min -> SILENT_S = 12 min, starting within 5 min before to 10 min after the end.
//  - Only counted when another server had captures in the same spell, so an outage of
//    our own feed (or of Census's event stream) is never read as a crash.
export const EARLY_END_S = 180;
export const SILENT_S = 720;
export const SILENT_FROM_S = 300;   // the quiet spell may start this long before the end ...
export const SILENT_UNTIL_S = 600;  // ... or up to this long after it
export const DECIDE_BY_S = SILENT_UNTIL_S + SILENT_S; // verdict at the latest end + 22 min

/** Seconds the alert ended before its planned length (0 when on time or late). */
export function endedEarlyS(startTs, dur, endTs) {
  return Math.max(0, startTs + dur * 60 - endTs);
}
export const isEarly = (startTs, dur, endTs) => endedEarlyS(startTs, dur, endTs) > EARLY_END_S;

/**
 * Did the alert's server go quiet right after the end?
 *   own:    sorted capture times on this server (any tracked continent) from endTs - SILENT_FROM_S on
 *   others: capture times on the other servers in the same window (proves the feed was working)
 * -> "silent" | "up" | "wait" (not sure yet) | "unknown" (no captures anywhere: feed gap, can't tell)
 */
export function silenceVerdict(own, others, endTs, now) {
  const from = endTs - SILENT_FROM_S, until = endTs + SILENT_UNTIL_S;
  const t = own.filter((x) => x >= from).sort((a, b) => a - b);
  // Quiet spells: [last capture (or from), next capture (or now)).
  let start = from;
  for (const x of [...t, now]) {
    const end = Math.min(x, now);
    if (start <= until && end - start >= SILENT_S) {
      const alive = others.some((o) => o > start && o < start + SILENT_S);
      return alive ? "silent" : "unknown";
    }
    if (x > until) break;
    start = Math.max(start, x);
  }
  if (now < endTs + DECIDE_BY_S && !t.some((x) => x > until)) return "wait";
  return "up";
}

// ------------------------------------------------------------- training history
// Known interrupted alerts ("world-zone-instance", the Worker's alert key), checked against
// Census capture events on 2026-11-01. Census reuses instance ids per world, hence the zone.
// 10-2-46374 is merged into a later alert by PS2Alerts, so it never reaches training from there.
export const KNOWN_INTERRUPTED = new Set(["10-2-46360", "10-2-46374", "10-2-45826", "13-8-37707", "13-8-36634", "13-6-36624", "17-2-54363", "40-2-32145"]);
// Early ends checked as normal (the server kept running): kept in training.
export const KNOWN_EARLY_OK = new Set(["1-6-49426", "1-8-48995", "10-6-45079"]);

/** Alert key from world, zone and an instance id (PS2Alerts writes it as "world-instance"). */
export const alertKey = (world, zone, id) => `${world}-${zone}-${String(id).split("-").pop()}`;

/**
 * Training filter for a history record { id, world, start, end, dur? , event? }.
 * Listed crashes are out; any other alert that ended 3+ min early is left out too
 * unless checked as normal (10 of ~5,000, so nothing worth keeping is lost).
 */
export function interruptedRecord(rec, plannedMin) {
  const key = alertKey(rec.world, rec.zone, rec.id);
  if (KNOWN_INTERRUPTED.has(key)) return true;
  if (KNOWN_EARLY_OK.has(key)) return false;
  const dur = plannedMin || rec.dur;
  if (!rec.start || !rec.end || !dur) return false;
  return isEarly(rec.start, dur, rec.end);
}
