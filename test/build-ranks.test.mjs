import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";
import { bareName, rankRow, buildRanks, autoHideFreshExceptional, isFreshHeld, FRESH_HOLD, autoHideMarathonRampage, marathonSession, MARATHON_HOLD, METRIC_COLS, RANK_COLS } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

describe("build-ranks", () => {
  it("strips outfit tags for the query / ?names= name", () => {
    assert.equal(bareName("[RITE] ShloDog"), "ShloDog");
    assert.equal(bareName("cheetler"), "cheetler");
    assert.equal(bareName("  [9753] coldandhot "), "coldandhot");
  });

  it("rankRow matches playerMetrics for every metric column (same code path)", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "players", "brackiense.json"), "utf8"));
    const m = playerMetrics(normalizePlayer(raw));
    const row = rankRow(raw, { slug: "brackiense", savedAt: raw.savedAt });
    assert.ok(row);
    assert.equal(row.length, RANK_COLS.length);
    assert.equal(row[0], "BrackieNSE");
    assert.equal(row[1], "BrackieNSE");
    assert.equal(row[2], "brackiense");
    for (let i = 0; i < METRIC_COLS.length; i++) {
      const id = METRIC_COLS[i];
      const got = row[4 + i];
      const want = m[id];
      if (want == null || !Number.isFinite(want)) {
        assert.equal(got, null, id);
      } else {
        assert.ok(Math.abs(got - want) < 1e-6, `${id}: ${got} vs ${want}`);
      }
    }
    // ⚔️ iVi below zero floors to 0 on the page; the stored value stays raw.
    assert.ok(typeof row[4] === "number");
  });

  it("buildRanks reads the shared cache and lists every usable player once", () => {
    const out = buildRanks(dataDir);
    assert.equal(out.cols.join(","), RANK_COLS.join(","));
    assert.ok(out.count >= 1000, `expected ≥1000, got ${out.count}`);
    assert.equal(out.rows.length, out.count);
    assert.ok(out.updatedAt);
    const names = new Set(out.rows.map((r) => r[2])); // slug
    assert.equal(names.size, out.count);
    // Known players present with sane ⚔️ iVi
    const shlo = out.rows.find((r) => r[2] === "shlodog");
    assert.ok(shlo, "shlodog in ranks");
    assert.equal(shlo[1], "ShloDog");
    assert.ok(typeof shlo[4] === "number" && shlo[4] > 0);
  });

  it("fresh-account auto-hide: ≤7d + exceptional stats are held out of ranks (Dayset rule 2026-10-15)", () => {
    const NOW = Date.now() / 1000;
    const fakeRow = ({ ageDays, adj, ekpm, created = NOW - ageDays * 86400 }) => {
      const row = new Array(RANK_COLS.length).fill(null);
      row[RANK_COLS.indexOf("created")] = created;
      row[4 + METRIC_COLS.indexOf("adj")] = adj;
      row[4 + METRIC_COLS.indexOf("ekpm")] = ekpm;
      return row;
    };
    assert.equal(isFreshHeld(fakeRow({ ageDays: 3, adj: 3000, ekpm: 0.5 }), NOW), true);
    assert.equal(isFreshHeld(fakeRow({ ageDays: 7, adj: FRESH_HOLD.MIN_ADJ, ekpm: FRESH_HOLD.MAX_EKPM }), NOW), true, "boundary inclusive");
    assert.equal(isFreshHeld(fakeRow({ ageDays: 8, adj: 3000, ekpm: 0.5 }), NOW), false, "aged out");
    assert.equal(isFreshHeld(fakeRow({ ageDays: 3, adj: 1000, ekpm: 0.5 }), NOW), false, "not exceptional");
    assert.equal(isFreshHeld(fakeRow({ ageDays: 3, adj: 3000, ekpm: 0.9 }), NOW), false, "opponents not slow");
    assert.equal(isFreshHeld(fakeRow({ ageDays: 3, adj: 3000, ekpm: 0.5, created: null }), NOW), false, "unknown age never held");
    assert.equal(isFreshHeld(fakeRow({ ageDays: -1, adj: 3000, ekpm: 0.5 }), NOW), false, "future created never held");
  });

  it("autoHideFreshExceptional appends fresh exceptional players to hidden.json; rebuild excludes them", () => {
    const NOW = Date.now() / 1000;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-hide-"));
    try {
      const dd = path.join(tmp, "data");
      fs.mkdirSync(path.join(dd, "players"), { recursive: true });
      // Same exceptional stats (invisbleman3, adj 4351), two account ages.
      const base = JSON.parse(fs.readFileSync(path.join(dataDir, "players", "invisbleman3.json"), "utf8"));
      const mk = (name, ageDays) => {
        const copy = JSON.parse(JSON.stringify(base));
        copy.player.display = name;
        copy.player.times = { ...copy.player.times, created: NOW - ageDays * 86400 };
        fs.writeFileSync(path.join(dd, "players", `${name.toLowerCase()}.json`), JSON.stringify(copy));
        return { name, file: `players/${name.toLowerCase()}.json`, slug: name.toLowerCase(), savedAt: base.savedAt };
      };
      const entries = [mk("FreshCopy", 2), mk("OldCopy", 30)];
      fs.writeFileSync(path.join(dd, "index.json"), JSON.stringify({ players: entries }));
      fs.writeFileSync(path.join(dd, "hidden.json"), JSON.stringify({ _note: "kept", players: {} }, null, 2));
      const added = autoHideFreshExceptional(dd, { nowSec: NOW });
      assert.equal(added.length, 1);
      assert.equal(added[0].name, "FreshCopy");
      const hiddenAfter = JSON.parse(fs.readFileSync(path.join(dd, "hidden.json"), "utf8"));
      assert.equal(hiddenAfter._note, "kept", "existing fields preserved");
      assert.ok(hiddenAfter.players.FreshCopy, "fresh copy auto-hidden");
      assert.ok(!hiddenAfter.players.OldCopy, "old copy untouched");
      assert.match(hiddenAfter.players.FreshCopy.reason, /auto-hidden/);
      assert.ok(!/^confirmed cheater/i.test(hiddenAfter.players.FreshCopy.reason), "auto-hide is not a confirmed-cheater claim");
      // Idempotent: second run adds nothing.
      assert.equal(autoHideFreshExceptional(dd, { nowSec: NOW }).length, 0);
      // Rebuild with the updated hidden.json excludes the fresh copy via the normal hidden path.
      const out = buildRanks(dd);
      const slugs = new Set(out.rows.map((r) => r[2]));
      assert.ok(!slugs.has("freshcopy"), "fresh copy excluded from ranks");
      assert.ok(slugs.has("oldcopy"), "old copy still ranked");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("marathonSession: boundary legs (kills, K/D, headshots all required)", () => {
    const s = (kills, deaths, kd, hs) => ({ kills, deaths, kd, hs });
    assert.equal(marathonSession({ a: s(341, 3, 113.7, 0.67) }).id, "a");
    assert.equal(marathonSession({ a: s(MARATHON_HOLD.MIN_KILLS, 4, MARATHON_HOLD.MIN_KD, MARATHON_HOLD.MIN_HS) }).id, "a", "boundary inclusive");
    assert.equal(marathonSession({ a: s(99, 1, 99, 0.9) }), null, "too few kills");
    assert.equal(marathonSession({ a: s(529, 38, 14, 0.59) }), null, "legit control shape (Simplenubb best) stays");
    assert.equal(marathonSession({ a: s(179, 1, 179, 0) }), null, "A2G farmer: no headshots, no catch");
    assert.equal(marathonSession({ a: s(200, 2, 100, null) }), null, "unknown headshots never catch");
    const worst = marathonSession({ a: s(150, 5, 30, 0.6), b: s(341, 3, 113.7, 0.67) });
    assert.equal(worst.id, "b", "worst = highest K/D");
  });

  it("autoHideMarathonRampage appends only the rampage shape; cleared + hidden + others stay", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marathon-hide-"));
    try {
      const dd = path.join(tmp, "data");
      fs.mkdirSync(dd, { recursive: true });
      fs.writeFileSync(path.join(dd, "hidden.json"), JSON.stringify({ _note: "kept", players: { AlreadyHidden: { reason: "confirmed cheater", at: "2026-10-01" } } }, null, 2));
      fs.writeFileSync(path.join(dd, "reviewed.json"), JSON.stringify({ players: { clearedguy: { decision: "cleared", note: "owner", at: "2026-10-20" } } }));
      fs.writeFileSync(path.join(dd, "forensics.json"), JSON.stringify({ players: {
        rampageguy: { name: "RampageGuy", cid: "111", sessions: { "77386971": { kills: 341, deaths: 3, kd: 113.7, hs: 0.67 }, "1": { kills: 50, deaths: 10, kd: 5, hs: 0.4 } } },
        a2gguy: { name: "A2GGuy", cid: "222", sessions: { "2": { kills: 179, deaths: 1, kd: 179, hs: 0 } } },
        legitguy: { name: "LegitGuy", cid: "333", sessions: { "3": { kills: 529, deaths: 38, kd: 14, hs: 0.59 } } },
        clearedguy: { name: "ClearedGuy", cid: "444", sessions: { "4": { kills: 300, deaths: 2, kd: 150, hs: 0.9 } } },
        alreadyhidden: { name: "AlreadyHidden", cid: "555", sessions: { "5": { kills: 300, deaths: 2, kd: 150, hs: 0.9 } } },
      } }));
      const added = autoHideMarathonRampage(dd, { today: "2026-10-22" });
      assert.equal(added.length, 1);
      assert.equal(added[0].name, "RampageGuy");
      assert.equal(added[0].session, "77386971", "cites the worst session");
      const hiddenAfter = JSON.parse(fs.readFileSync(path.join(dd, "hidden.json"), "utf8"));
      assert.equal(hiddenAfter._note, "kept", "existing fields preserved");
      assert.match(hiddenAfter.players.RampageGuy.reason, /auto-hidden: marathon rampage session 77386971 \(341 kills \/ 3 deaths, K\/D 113\.7, 67% headshots\)/);
      assert.ok(!/^confirmed cheater/i.test(hiddenAfter.players.RampageGuy.reason), "auto-hide is not a confirmed-cheater claim");
      assert.ok(!hiddenAfter.players.A2GGuy && !hiddenAfter.players.LegitGuy && !hiddenAfter.players.ClearedGuy, "aim leg / K/D leg / owner clearance all respected");
      assert.equal(autoHideMarathonRampage(dd, { today: "2026-10-22" }).length, 0, "idempotent");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

import { mergeFreshRows } from "../rank-row.mjs";
describe("Rankings use this browser's fresher copy (t338u)", () => {
  it("recomputes only players whose browser copy is newer; others stay shared", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "players", "brackiense.json"), "utf8"));
    const old = rankRow(raw, { slug: "brackiense", savedAt: 1000 });
    const other = old.slice(); other[0] = "Other"; other[1] = "Other"; other[2] = "other";
    const payload = { cols: RANK_COLS.slice(), rows: [old, other] };
    const p = raw.player || raw;
    const tweaked = { ...p, global_kd: (+p.global_kd || 1) * 2 };
    const now = Date.now();
    const store = { brackiense: { name: "BrackieNSE", savedAt: now, fetchedAt: now, player: tweaked } };
    const { rows, fresh } = mergeFreshRows(payload, store, { now });
    assert.equal(fresh.get("brackiense"), now);
    assert.equal(fresh.size, 1);
    assert.equal(rows[1], other);
    assert.equal(rows[0][3], now);
    const kd = RANK_COLS.indexOf("kd");
    assert.ok(Math.abs(rows[0][kd] - old[kd] * 2) < 1e-3 * Math.max(1, old[kd]));
    // Older browser copy → shared row kept.
    const stale = { brackiense: { name: "BrackieNSE", savedAt: now, fetchedAt: 500, player: tweaked } };
    const r2 = mergeFreshRows(payload, stale, { now });
    assert.equal(r2.fresh.size, 0);
    assert.equal(r2.rows[0], old);
  });
});

describe("Graphed players missing from ranks.json join as local-only rows (t359u)", () => {
  it("adds an unranked graphed name from the browser copy; skips hidden / ungraphed", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "players", "brackiense.json"), "utf8"));
    const old = rankRow(raw, { slug: "brackiense", savedAt: 1000 });
    const payload = { cols: RANK_COLS.slice(), rows: [old] };
    const p = raw.player || raw;
    const now = Date.now();
    const neu = { ...p, display: "[NEW] Newbie", name: "Newbie" };
    const store = {
      newbie: { name: "Newbie", savedAt: now, fetchedAt: now, player: neu },
      other: { name: "Other", savedAt: now, fetchedAt: now, player: { ...p, display: "Other" } },
    };
    // Not graphed → stays out (old behaviour).
    assert.equal(mergeFreshRows(payload, store, { now }).rows.length, 1);
    const m = mergeFreshRows(payload, store, { now, extra: ["Newbie"] });
    assert.equal(m.rows.length, 2);
    assert.equal(m.rows[0], old, "shared row untouched");
    assert.equal(m.rows[1][1], "Newbie");
    assert.equal(m.rows[1][2], "newbie");
    assert.equal(m.rows[1][3], now);
    assert.ok(m.localOnly.has("newbie") && m.fresh.get("newbie") === now);
    assert.ok(Number.isFinite(m.rows[1][RANK_COLS.indexOf("kd")]));
    // Already ranked → never duplicated; 🙈 hidden → skipped.
    assert.equal(mergeFreshRows(payload, store, { now, extra: ["BrackieNSE"] }).rows.length, 1);
    assert.equal(mergeFreshRows(payload, store, { now, extra: ["Newbie"], skip: (e, k) => k === "newbie" }).rows.length, 1);
  });
});
