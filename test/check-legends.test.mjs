import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateLegend,
  repetitionViolations,
  checkShards,
  wordCount,
  badDigits,
} from "../scripts/check-legends.mjs";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

/** Clean filler text with exactly n words (no digits, pronouns, banned or role words). */
const filler = (n) => Array(n).fill("steady").join(" ");

function card(over = {}) {
  return {
    slug: "testy",
    name: "Testy",
    query: "Testy",
    eligible: true,
    ineligibleReason: null,
    basis: "mid|mid|mid|mid|mid|mid|mid|mid|mid|mid|mid|mid|active",
    ...over,
  };
}

test("word count: 45–90 pass, 44 and 91 fail", () => {
  assert.deepEqual(validateLegend({ slug: "testy", text: filler(44), basis: card().basis, card: card() }).filter((m) => m.includes("words")), ["only 44 words (min 45)"]);
  assert.deepEqual(validateLegend({ slug: "testy", text: filler(45), basis: card().basis, card: card() }), []);
  assert.deepEqual(validateLegend({ slug: "testy", text: filler(90), basis: card().basis, card: card() }), []);
  assert.ok(validateLegend({ slug: "testy", text: filler(91), basis: card().basis, card: card() }).some((m) => m.includes("91 words")));
  assert.equal(wordCount("  a  b\tc\n"), 3);
});

test("digits: years pass, other numbers fail, the player's own name is stripped", () => {
  const ok = card();
  assert.deepEqual(validateLegend({ slug: "testy", text: `${filler(43)} since 2016`, basis: ok.basis, card: ok }).filter((m) => m.includes("digits")), []);
  const bad = validateLegend({ slug: "testy", text: `${filler(43)} about 1.3 kills`, basis: ok.basis, card: ok });
  assert.ok(bad.some((m) => m.includes("digits")));
  assert.deepEqual(badDigits("since 2016 and 2026", {}), []);
  assert.deepEqual(badDigits("1.3 kills", {}), ["1", "3"]);
  assert.deepEqual(badDigits("4UA plays on", { name: "4UA", query: "4UA", slug: "4ua" }), []);
  assert.deepEqual(badDigits("beat 4UA twice", { name: "4UA", query: "4UA", slug: "4ua" }), []);
});

test("pronouns: he/him/his/she/her fail, they/their/history pass", () => {
  const ok = card();
  for (const w of ["he", "him", "his", "she", "her", "He"]) {
    assert.ok(validateLegend({ slug: "testy", text: `${filler(44)} ${w}`, basis: ok.basis, card: ok }).some((m) => m.includes("pronoun")), w);
  }
  assert.deepEqual(validateLegend({ slug: "testy", text: `${filler(43)} they their`, basis: ok.basis, card: ok }).filter((m) => m.includes("pronoun")), []);
  assert.deepEqual(validateLegend({ slug: "testy", text: `${filler(42)} the history books`, basis: ok.basis, card: ok }).filter((m) => m.includes("pronoun")), []);
});

test("banned words: cheating/padding/farming/flag family fails", () => {
  const ok = card();
  for (const w of ["cheat", "padding", "padder", "farming", "suspicious", "flagged", "aimbot"]) {
    assert.ok(validateLegend({ slug: "testy", text: `${filler(44)} ${w}`, basis: ok.basis, card: ok }).some((m) => m.includes("banned")), w);
  }
});

test("role words fail without an owner note, pass with one; lowercase maximum is fine", () => {
  const ok = card();
  for (const w of ["MAX", "stalker", "infiltrator", "medic", "heavy", "tank", "ESF", "light assault"]) {
    assert.ok(validateLegend({ slug: "testy", text: `${filler(44)} ${w}`, basis: ok.basis, card: ok }).some((m) => m.includes("role")), w);
    assert.deepEqual(
      validateLegend({ slug: "testy", text: `${filler(44)} ${w}`, basis: ok.basis, card: ok, hasOwnerNote: true }).filter((m) => m.includes("role")),
      [],
      w,
    );
  }
  assert.deepEqual(validateLegend({ slug: "testy", text: `${filler(43)} maximum effort`, basis: ok.basis, card: ok }).filter((m) => m.includes("role")), []);
});

test("relational words fail without an owner note, pass with one", () => {
  const ok = card();
  for (const w of ["teammate", "squadmates", "squad", "duo", "partner", "rival", "nemesis", "alt", "alts", "same outfit", "same squad"]) {
    assert.ok(validateLegend({ slug: "testy", text: `${filler(44)} ${w}`, basis: ok.basis, card: ok }).some((m) => m.includes("relates players")), w);
    assert.deepEqual(
      validateLegend({ slug: "testy", text: `${filler(44)} ${w}`, basis: ok.basis, card: ok, hasOwnerNote: true }).filter((m) => m.includes("relates players")),
      [],
      w,
    );
  }
});

test("basis + eligibility: mismatch and ineligible players fail, unknown slugs fail", () => {
  const ok = card();
  assert.ok(validateLegend({ slug: "testy", text: filler(45), basis: "other|basis", card: ok }).some((m) => m.includes("basis mismatch")));
  assert.ok(validateLegend({ slug: "testy", text: filler(45), basis: ok.basis, card: card({ eligible: false, ineligibleReason: "thin" }) }).some((m) => m.includes("not eligible")));
  assert.ok(validateLegend({ slug: "ghost", text: filler(45), basis: "x", card: undefined }).some((m) => m.includes("not in ranks.json")));
});

test("repetition guard: duplicate openings and 6-word phrases over 25", () => {
  // Unique filler per legend so only the shared phrase can trip the guard.
  const uniq = (i, n) => Array.from({ length: n }, (_, j) => `u${i}x${j}`).join(" ");
  const two = [
    { slug: "a", text: "One two three plus " + uniq(0, 40) },
    { slug: "b", text: "One two three plus " + uniq(1, 40) },
  ];
  assert.ok(repetitionViolations(two).some((m) => m.includes('opening "one two three"')));
  assert.deepEqual(repetitionViolations([{ slug: "a", text: "One two three plus " + uniq(0, 40) }]), []);
  const phrase = "alpha beta gamma delta epsilon zeta";
  const many = Array.from({ length: 26 }, (_, i) => ({ slug: `p${i}`, text: `Start${i} ${phrase} ` + uniq(i, 38) }));
  assert.ok(repetitionViolations(many).some((m) => m.includes("alpha beta gamma delta epsilon zeta")));
  const ok25 = Array.from({ length: 25 }, (_, i) => ({ slug: `q${i}`, text: `Start${i} ${phrase} ` + uniq(i, 38) }));
  assert.deepEqual(repetitionViolations(ok25), []);
});

test("checkShards passes over the real shards on disk", () => {
  const report = checkShards(DATA_DIR);
  assert.equal(report.violations.length, 0, JSON.stringify(report.violations, null, 2));
  assert.ok(report.legendCount >= 5, `expected ≥5 migrated legends, got ${report.legendCount}`);
});
