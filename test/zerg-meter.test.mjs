// 🪳 Zerg meter (zerg-meter.html): geometry, motion and the page's
// minimalism. The meter must read true against the printed scale: the
// laser sits at the value's level, the roach's eyes sit on the laser, and
// the roach never covers the numbers.
// test-select-reaches: zerg-meter.mjs zerg-meter.html
// test-select: imports only
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  METER, clampZerg, valueToY, roachHeight, roachTop, createMotion, meterValue,
  parseLastEventRow, createFightQueue, fightTitle, shouldFadeDown, FADE_IDLE_MS,
  hasArrived, MARK_ARRIVE_EPS,
} from "../zerg-meter-motion.mjs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("meter geometry (measured off assets/zerg-meter-bg.jpg)", () => {
  it("value maps linearly to the printed scale", () => {
    assert.equal(valueToY(0), METER.y0);
    assert.equal(valueToY(100), METER.y100);
    assert.ok(Math.abs(valueToY(50) - (METER.y0 + METER.y100) / 2) < 1e-12);
    assert.equal(valueToY(150), METER.y100, "clamps above 100");
    assert.equal(valueToY(-5), METER.y0, "clamps below 0");
    assert.equal(valueToY(NaN), null, "no reading without a value");
    assert.equal(clampZerg(94.32), 94.32);
  });

  it("the roach's eyes sit on the value's level", () => {
    for (const v of [0, 10, 41.5, 50, 88, 100]) {
      const eye = roachTop(v) + METER.eyeY * roachHeight();
      assert.ok(Math.abs(eye - valueToY(v)) < 1e-12, `v=${v}`);
    }
  });

  it("the roach never covers the scale numbers", () => {
    // Content spans 15.6–84.2% of the sprite (measured); digits start 62.7%.
    const right = METER.barX + (0.842 - 0.5) * METER.roachW;
    const left = METER.barX - (0.5 - 0.156) * METER.roachW;
    assert.ok(right < 0.627, `roach content right ${right} < digits 0.627`);
    assert.ok(left > 0, "roach stays inside the image on the left");
  });

  it("the roach's content fits inside the image at both ends", () => {
    // Content spans 9.4–90.3% of the sprite height (measured).
    assert.ok(roachTop(100) + 0.094 * roachHeight() >= 0, "top at v=100");
    assert.ok(roachTop(0) + 0.903 * roachHeight() <= 1, "bottom at v=0");
  });

  it("the laser sits between the roach and the digits", () => {
    assert.ok(METER.laser.x0 > METER.barX, "laser starts right of the bar centre");
    assert.ok(METER.laser.x1 < 0.627, "laser ends left of the digits");
    assert.ok(METER.laser.x1 - METER.laser.x0 > 0.1, "laser is visible, not a dot");
  });
});

describe("1-second refresh: parsing the latest kill/death from characters_event", () => {
  const killRow = { character_id: "8261280742797131393", attacker_character_id: "5428010917269715233", timestamp: "1794530283" };
  const deathRow = { character_id: "5428010917269715233", attacker_character_id: "5429683080379828913", timestamp: "1794530346" };
  it("a kill row's opponent is the victim, a death row's is the killer", () => {
    assert.deepEqual(parseLastEventRow(killRow, "kill"), { opp: "8261280742797131393", ts: 1794530283, kind: "kill" });
    assert.deepEqual(parseLastEventRow(deathRow, "death"), { opp: "5429683080379828913", ts: 1794530346, kind: "death" });
  });
  it("rows with no opponent or no timestamp are not a last fight", () => {
    assert.equal(parseLastEventRow({ character_id: "0", timestamp: "1794530283" }, "kill"), null);
    assert.equal(parseLastEventRow({ character_id: "8261280742797131393" }, "kill"), null);
    assert.equal(parseLastEventRow({ character_id: "8261280742797131393", timestamp: "soon" }, "kill"), null);
    assert.equal(parseLastEventRow(null, "kill"), null);
    assert.equal(parseLastEventRow(killRow, "login"), null);
  });
});

describe("fight queue: every kill and death gets its turn, in fight order", () => {
  const kill = (opp, ts, zerg = 26) => ({ opp, ts, kind: "kill", zerg, name: `victim-${opp}` });
  const death = (opp, ts, zerg = 7) => ({ opp, ts, kind: "death", zerg, name: `killer-${opp}` });
  it("plays kills and deaths in timestamp order, one per dwell", () => {
    const q = createFightQueue({ dwellMs: 2000, max: 20 });
    assert.equal(q.offer(death("9", 105)), true);
    assert.equal(q.offer(kill("1", 100)), true);
    assert.equal(q.offer(kill("2", 102)), true);
    assert.equal(q.size, 3);
    assert.equal(q.tick(1000).opp, "1", "the earliest fight shows first");
    assert.equal(q.tick(1500), null, "still inside the dwell");
    assert.equal(q.tick(2999), null, "1 ms before the dwell ends");
    assert.equal(q.tick(3000).opp, "2", "the next fight at the dwell");
    assert.equal(q.tick(5000).opp, "9", "the death shows exactly like a kill");
    assert.equal(q.tick(7000), null, "queue empty: keeps the last one showing");
    assert.equal(q.current.opp, "9");
  });
  it("the same fight offered twice (stream + poll) shows once", () => {
    const q = createFightQueue({ dwellMs: 2000, max: 20 });
    assert.equal(q.offer(kill("1", 100)), true);
    assert.equal(q.offer(kill("1", 100)), false, "same opponent, same second");
    assert.equal(q.offer(kill("2", 100)), true, "two kills in the same second are two fights");
    assert.equal(q.size, 2);
  });
  it("a slow lookup can't reorder two fights (sorted insert)", () => {
    const q = createFightQueue({ dwellMs: 2000, max: 20 });
    q.offer(kill("2", 102));
    q.offer(kill("1", 100)); // resolves later, still sorts first
    assert.equal(q.tick(0).opp, "1");
  });
  it("past the cap the oldest drops, the newest stays", () => {
    const q = createFightQueue({ dwellMs: 2000, max: 3 });
    for (let i = 0; i < 5; i++) q.offer(kill(String(i), 100 + i));
    assert.equal(q.size, 3);
    assert.equal(q.tick(0).opp, "2");
  });
  it("queues an unknown opponent (zerg null) as a mirror event, not a number", () => {
    const q = createFightQueue({ dwellMs: 2000, max: 20 });
    assert.equal(q.offer({ opp: "5429078932898658897", ts: 100, kind: "kill", zerg: null, name: "SnowfallV" }), true);
    assert.equal(q.size, 1);
    const got = q.tick(100);
    assert.equal(got.name, "SnowfallV");
    assert.equal(got.kind, "kill");
    assert.equal(got.zerg, null);
  });
});

describe("decay: the meter fades down to rest after 10 s with no fights", () => {
  const base = { queueEmpty: true, hasCurrent: true, currentSinceMs: 1000, nowMs: 1000, faded: false };
  it("the idle window is 10 s, counted from when the last fight showed", () => {
    assert.equal(FADE_IDLE_MS, 10000);
    assert.equal(shouldFadeDown({ ...base, nowMs: 1000 + 9999 }), false, "1 ms early");
    assert.equal(shouldFadeDown({ ...base, nowMs: 1000 + 10000 }), true, "exactly 10 s");
    assert.equal(shouldFadeDown({ ...base, nowMs: 1000 + 20000 }), true);
  });
  it("never fades while the queue still has fights, or before any fight showed", () => {
    assert.equal(shouldFadeDown({ ...base, queueEmpty: false, nowMs: 11000 }), false, "queue still draining");
    assert.equal(shouldFadeDown({ ...base, hasCurrent: false, nowMs: 11000 }), false, "nothing shown yet");
    assert.equal(shouldFadeDown({ ...base, currentSinceMs: null, nowMs: 11000 }), false);
    assert.equal(shouldFadeDown({ ...base, nowMs: 11000, faded: true }), false, "already faded");
  });
  it("the queue reports when the current fight started showing", () => {
    const q = createFightQueue({ dwellMs: 2000, max: 20 });
    assert.equal(q.currentSince, null);
    q.offer({ opp: "1", ts: 100, kind: "kill", zerg: 26, name: "x" });
    q.tick(5000);
    assert.equal(q.currentSince, 5000);
  });
});

describe("marks: placed when the roach arrives, never before it moved", () => {
  it("arrival means within one Zerg point of the level", () => {
    assert.equal(MARK_ARRIVE_EPS, 1.0);
    assert.equal(hasArrived(25.0, 26), true, "exactly one point away counts");
    assert.equal(hasArrived(25.2, 26), true);
    assert.equal(hasArrived(24.9, 26), false, "more than a point away is still travelling");
    assert.equal(hasArrived(22.6, 26), false, "half a second into a rise from 1");
    assert.equal(hasArrived(null, 26), false);
    assert.equal(hasArrived(26, null), false);
  });
  it("a big fall outlasts the dwell, so the mark waits for departure", () => {
    // Fall 26 -> 6 (tau 800 ms): after the 2 s dwell the roach is at ~7.6,
    // still 1.6 away — not arrived. A rise 1 -> 26 (tau 250 ms) arrives
    // in ~0.8 s, inside the dwell.
    const fall = createMotion();
    let shown = fall.update(26, 0);
    shown = fall.update(6, 2000);
    assert.equal(hasArrived(shown, 6), false, `roach at ${shown.toFixed(1)}, not at 6 yet`);
    const rise = createMotion();
    shown = rise.update(1, 0);
    assert.equal(hasArrived(rise.update(26, 800), 26), false, "0.80 s in, still a point away");
    shown = rise.update(26, 900);
    assert.equal(hasArrived(shown, 26), true, `roach at ${shown.toFixed(1)}, arrived`);
  });
});

describe("fight title: kills and deaths read differently", () => {
  it("an unknown value reads '?' — never a number that isn't the opponent's", () => {
    assert.equal(fightTitle("kill", "SnowfallV", null), "🪳 killed SnowfallV — Zerg ?");
    assert.equal(fightTitle("death", "SnowfallV", null), "🪳 killed by SnowfallV — Zerg ?");
    assert.equal(fightTitle(null, "Zewgie", null), "🪳 Zewgie Zerg ?");
  });
  it("names the direction — the number alone can't tell them apart", () => {
    assert.equal(fightTitle("kill", "Fantom220TR", 26), "🪳 killed Fantom220TR — Zerg 26.0");
    assert.equal(fightTitle("death", "Zugie", 7), "🪳 killed by Zugie — Zerg 7.0");
    assert.equal(fightTitle(null, "Zewgie", 1), "🪳 Zewgie Zerg 1.0");
  });
});

describe("meter reading: last opponent's Zerg, own lifetime only as the rest", () => {
  it("shows the last opponent once known, never the followed player's own score", () => {
    assert.equal(meterValue(1, 42), 42, "last opponent wins over the resting value");
    assert.equal(meterValue(1, 0), 0, "an opponent Zerg of 0 is a reading, not a missing one");
    assert.equal(meterValue(1, null), 1, "rests at own lifetime before the first known opponent");
    assert.equal(meterValue(null, 30), 30, "no own lifetime needed once an opponent scores");
    assert.equal(meterValue(null, null), null, "nothing to show for an unranked player yet");
    assert.equal(meterValue(null, NaN), null);
  });
});

describe("DPS-meter motion: slowed jump up, slide down", () => {
  it("rise covers most of a jump in one rise τ; fall covers less in the same time", () => {
    const m = createMotion();
    m.update(20, 0);
    const risen = m.update(80, 250); // one rise τ
    assert.ok(risen - 20 > 0.6 * 60, `rose to ${risen}`);
    const f = createMotion();
    f.update(80, 0);
    const fallen = f.update(20, 250); // one rise τ, but falling uses the fall τ
    assert.ok(80 - fallen < 0.35 * 60, `fell only to ${fallen}`);
  });

  it("settles exactly on the target and ignores nulls", () => {
    const m = createMotion();
    m.update(40, 0);
    assert.equal(m.update(40, 10000), 40);
    assert.equal(m.update(null, 20000), 40);
    assert.equal(m.update(150, 21000), 100, "clamps to the top of the scale");
  });
});

describe("page: meter only, and shared pins match live.mjs", () => {
  it("no links, headers, footers, nav or site chrome", () => {
    const html = read("zerg-meter.html");
    assert.doesNotMatch(html, /<a[\s>]/, "no links");
    assert.doesNotMatch(html, /<(header|footer|nav)[\s>]/, "no header/footer/nav");
    assert.doesNotMatch(html, /styles\.css/, "no site stylesheet");
    assert.doesNotMatch(html, /background-image/, "no page background image");
    assert.match(html, /background: #000/, "solid black page by default");
    assert.match(html, /assets\/zerg-meter-bg\.png/, "clean meter background (transparent PNG)");
    assert.match(html, /transparent/, "?transparent=1 overlay mode (transparent page for a stream)");
    assert.match(html, /zm-transparent/, "transparent page class");
    assert.match(html, /assets\/zerg-roach\.png/, "outlined roach");
  });

  it("the meter module shares live.mjs's pinned imports (no silent drift)", () => {
    const meter = read("zerg-meter.mjs");
    const live = read("live.mjs");
    for (const mod of ["live-model.mjs", "config.mjs", "trait-scores.mjs"]) {
      const pin = (src) => {
        const m = src.match(new RegExp(`"\\./${mod}\\?v=([^"]+)"`));
        assert.ok(m, `${mod} pinned in source`);
        return m[1];
      };
      assert.equal(pin(meter), pin(live), `${mod} pin`);
    }
    assert.match(read("zerg-meter.html"), /zerg-meter\.mjs\?v=20261113-zm9/);
    assert.match(meter, /zerg-meter-motion\.mjs\?v=20261113-zm6/);
  });
});
