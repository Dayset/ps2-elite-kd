import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeSessionKills, isRampage, rampageCleared, RAMPAGE_REASON_PREFIX } from "../rampage-gate.mjs";
import { applyRampage } from "../scripts/rampage-gate.mjs";
import { rampageStatus } from "../scripts/build-ranks.mjs";

const kill = (o = {}) => ({
  event: { attackerCharacterID: "1", killedCharacterID: "2", attackerTeamID: 1, killedTeamID: 2, attackerVehicleID: 0, weaponID: 80, isHeadshot: false, ...o.e },
  item: { isVehicleWeapon: false, ...o.item }, fireGroupToFireMode: { fireModeIndex: o.fmi ?? 0 },
});

test("summary: own infantry kills only; hipfire = fire mode index 0, ADS = 1", () => {
  const rows = [kill({ e: { isHeadshot: true } }), kill({ fmi: 1 }), kill({ e: { attackerVehicleID: 5 } }), kill({ item: { isVehicleWeapon: true } }),
    kill({ e: { killedTeamID: 1 } }), kill({ e: { attackerCharacterID: "9" } }), kill({ e: { weaponID: 0 } })];
  assert.deepEqual(summarizeSessionKills(rows, "1"), { kills: 5, inf: 2, hs: 1, hip: 1, ads: 1 });
});

test("rule: VanuBestFaction2-like session matches; legit shapes don't", () => {
  assert.ok(isRampage({ inf: 177, hs: 122, hip: 177, ads: 0 })); // model case
  assert.ok(!isRampage({ inf: 35, hs: 19, hip: 35, ads: 0 })); // too few kills
  assert.ok(!isRampage({ inf: 117, hs: 25, hip: 116, ads: 1 })); // MAX / hipfire but low HS (ALandWhale-like)
  assert.ok(!isRampage({ inf: 66, hs: 54, hip: 16, ads: 50 })); // high HS but ADS (Shrimp-like)
  assert.ok(!isRampage({ inf: 102, hs: 47, hip: 14, ads: 88 })); // enablescaleformfonts1
});

test("hidden.json sync: add with evidence, skip already hidden, owner clear un-hides auto entries only", () => {
  const s = { slug: "bad", name: "[X] Bad", cid: "1", session: "77", inf: 100, hs: 70, hip: 100, ads: 0, minutes: 10, kpm: 10, match: true };
  const r1 = applyRampage({ players: {} }, { 77: s }, null, "2026-10-19");
  assert.deepEqual(r1.added, ["Bad"]);
  assert.ok(r1.players.Bad.reason.startsWith(RAMPAGE_REASON_PREFIX) && r1.players.Bad.reason.includes("hipfire 100%"));
  assert.deepEqual(applyRampage({ players: r1.players }, { 77: s }, null, "2026-10-19").added, []);
  const owner = { players: { Bad: { reason: "confirmed cheater — manual", at: "x" } } };
  const cleared = { players: { bad: { burst: "cleared" } } };
  assert.ok(rampageCleared(cleared, "bad"));
  const r2 = applyRampage({ players: r1.players }, { 77: s }, cleared, "2026-10-19");
  assert.deepEqual(r2.removed, ["Bad"]);
  assert.equal(r2.players.Bad, undefined);
  assert.deepEqual(applyRampage(owner, { 77: s }, cleared, "d").removed, []); // manual entries never touched
});

test("🛡️ carve-out: established players are never auto-flagged", () => {
  const s = { slug: "vet", name: "[X] Vet", cid: "1", session: "77", inf: 100, hs: 70, hip: 100, ads: 0, minutes: 10, kpm: 10, match: true };
  const r = applyRampage({ players: {} }, { 77: s }, null, "2026-10-30", new Set(["vet"]));
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.skippedEstablished, ["vet"]);
  assert.equal(r.players.Vet, undefined);
});

test("build-log status hides owner-cleared players completely", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rampage-"));
  const ses = (slug, id) => ({ slug, name: slug, cid: id, inf: 100, hs: 70, hip: 100, ads: 0, minutes: 10, kpm: 10, match: true });
  fs.writeFileSync(path.join(dir, "rampage.json"), JSON.stringify({ sessions: { 1: ses("bad", "1"), 2: ses("okguy", "2") } }));
  fs.writeFileSync(path.join(dir, "reviewed.json"), JSON.stringify({ players: { okguy: { burst: "cleared" } } }));
  fs.writeFileSync(path.join(dir, "hidden.json"), JSON.stringify({ players: {} }));
  const st = rampageStatus(dir);
  assert.deepEqual(st.caught.map((c) => c.slug), ["bad"]);
  assert.equal(st.players, 1);
  assert.ok(!JSON.stringify(st).includes("okguy"));
});

test("real data: no reviewed / legit reference player is caught", () => {
  const rp = JSON.parse(fs.readFileSync(new URL("../data/rampage.json", import.meta.url), "utf8"));
  const legit = ["zugie", "zugiee", "zoogie", "zewgie", "zugietr", "zyr0sncx", "enablescaleformfonts1", "majorkek", "alandwhalenc", "alandwhaletr", "shrimpehx", "justv6me", "loontiq"];
  for (const s of Object.values(rp.sessions)) if (s.match) assert.ok(!legit.includes(s.slug), s.slug);
  assert.ok(Object.values(rp.sessions).some((s) => s.slug === "vanubestfaction2" && s.match));
});
