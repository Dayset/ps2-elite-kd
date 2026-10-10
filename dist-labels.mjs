/**
 * Name-label layout for the Rankings distribution chart (t338u): several
 * picked players close together used to print their names on top of each
 * other. Each label is centred over its marker when there is room; otherwise
 * it goes to the first row (stacked above the plot) where it doesn't touch
 * another label, nudged sideways if needed (a thin leader line joins it to its
 * marker). The font only shrinks, one step at a time, when names still
 * wouldn't fit in maxRows rows. DOM-free (tests import it).
 */

/** Rough bold-text width in px when the real width can't be measured. */
export function estimateWidth(text, fontPx) {
  return String(text || "").length * fontPx * 0.62 + 2;
}

/**
 * items: [{ x, w }] marker x and label width (px, at fontPx = 1 scale → use
 *        widthAt(i, scale) when given). Order is kept in the result.
 * opts:  minX / maxX  label area bounds; gap px between labels; maxRows;
 *        widthAt(i, scale) → width at a font scale (default w × scale);
 *        scales  font scales to try, largest first.
 * Returns { scale, rows, labels: [{ cx, row, shifted }] } (cx = label centre).
 */
export function layoutLabels(items, { minX = 0, maxX = 1000, gap = 6, maxRows = 4, widthAt = null, scales = [1, 0.9, 0.8] } = {}) {
  const list = (items || []).map((it, i) => ({ i, x: +it.x, w: +it.w || 0 }));
  if (!list.length) return { scale: 1, rows: 0, labels: [] };
  let best = null;
  for (const scale of scales) {
    const res = place(list, scale);
    if (!best || res.overflow < best.overflow) best = res;
    if (res.overflow === 0) { best = res; break; }
  }
  return { scale: best.scale, rows: best.rows, labels: best.labels };

  function place(lst, scale) {
    const order = lst.slice().sort((a, b) => a.x - b.x || a.i - b.i);
    const rows = []; // per row: placed intervals [l, r]
    const labels = new Array(lst.length);
    let overflow = 0;
    for (const it of order) {
      const w = Math.min(maxX - minX, widthAt ? widthAt(it.i, scale) : it.w * scale);
      const clamp = (c) => Math.max(minX + w / 2, Math.min(maxX - w / 2, c));
      const want = clamp(it.x);
      let done = false;
      // 1) centred (or edge-clamped) over the marker in the first free row
      for (let r = 0; r < maxRows && !done; r++) {
        const row = rows[r] || (rows[r] = []);
        if (fits(row, want - w / 2, want + w / 2)) { put(r, want, w, it); done = true; }
      }
      // 2) nudged sideways, as close to the marker as possible, in any row
      if (!done) {
        let pick = null;
        for (let r = 0; r < maxRows; r++) {
          const row = rows[r] || (rows[r] = []);
          for (const c of candidates(row, w)) {
            const cc = clamp(c);
            if (!fits(row, cc - w / 2, cc + w / 2)) continue;
            const cost = Math.abs(cc - it.x) + r * 4;
            if (!pick || cost < pick.cost) pick = { r, c: cc, cost };
          }
        }
        if (pick && pick.cost - pick.r * 4 <= Math.max(60, w * 1.5)) { put(pick.r, pick.c, w, it); done = true; }
      }
      // 3) no room: least-crowded row, centred (counts as overflow)
      if (!done) {
        let r0 = 0;
        for (let r = 1; r < maxRows; r++) if (overlapPx(rows[r] || [], want, w) < overlapPx(rows[r0] || [], want, w)) r0 = r;
        overflow += 1;
        put(r0, want, w, it);
      }
    }
    return { scale, rows: Math.max(...labels.map((l) => l.row)) + 1, labels, overflow };

    function put(r, c, w, it) {
      (rows[r] || (rows[r] = [])).push([c - w / 2, c + w / 2]);
      labels[it.i] = { cx: c, row: r, shifted: Math.abs(c - it.x) > 1.5 };
    }
  }
  function fits(row, l, r) {
    return row.every(([a, b]) => r + gap <= a || l >= b + gap);
  }
  function candidates(row, w) {
    const out = [];
    for (const [a, b] of row) { out.push(a - gap - w / 2, b + gap + w / 2); }
    return out;
  }
  function overlapPx(row, c, w) {
    let s = 0;
    for (const [a, b] of row) s += Math.max(0, Math.min(b + gap, c + w / 2) - Math.max(a - gap, c - w / 2));
    return s;
  }
}
