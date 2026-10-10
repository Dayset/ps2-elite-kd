import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutLabels, estimateWidth } from "../dist-labels.mjs";

const overlaps = (lay, items, gap) => {
  const box = lay.labels.map((l, i) => ({ row: l.row, a: l.cx - items[i].w * lay.scale / 2, b: l.cx + items[i].w * lay.scale / 2 }));
  for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
    if (box[i].row === box[j].row && box[i].b + gap - 0.01 > box[j].a && box[j].b + gap - 0.01 > box[i].a) return true;
  }
  return false;
};

describe("dist-labels (t338u: names on the Rankings chart never stack)", () => {
  it("lone label sits centred over its marker in row 0", () => {
    const r = layoutLabels([{ x: 200, w: 60 }], { minX: 0, maxX: 400 });
    assert.deepEqual(r.labels[0], { cx: 200, row: 0, shifted: false });
    assert.equal(r.rows, 1);
  });
  it("close names go to separate rows / sideways, never overlapping", () => {
    const items = [100, 104, 108, 111, 115, 300].map((x) => ({ x, w: 70 }));
    const r = layoutLabels(items, { minX: 0, maxX: 400, gap: 6, maxRows: 4 });
    assert.equal(overlaps(r, items, 6), false);
    assert.ok(r.rows <= 4);
  });
  it("labels stay inside the chart near the edges", () => {
    const items = [{ x: 2, w: 80 }, { x: 398, w: 80 }];
    const r = layoutLabels(items, { minX: 0, maxX: 400 });
    assert.ok(r.labels[0].cx - 40 >= 0 && r.labels[1].cx + 40 <= 400);
  });
  it("10 names in one spot on a phone: shrinks only as a last resort, still no overlap", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ x: 160 + i, w: estimateWidth("PlayerName" + i, 10) }));
    const r = layoutLabels(items, { minX: 0, maxX: 340, gap: 5, maxRows: 5 });
    assert.equal(overlaps(r, items, 5), false);
    const spread = layoutLabels([{ x: 50, w: 60 }, { x: 250, w: 60 }], { minX: 0, maxX: 340 });
    assert.equal(spread.scale, 1);
  });
});
