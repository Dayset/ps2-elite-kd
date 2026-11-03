// Status lines (#107, pure): the small stack over a front-lane fighter.
// Every line stays at least 2.5 s of WALL time (the caller passes wallT, so
// playback speed never shortens it), then fades over 0.5 s. Repeats merge
// ("reloading ×2") instead of stacking, and the stack holds at most 3 lines
// (oldest drops when a fourth arrives). Newest at the bottom: the array is
// oldest-first, the renderer draws it top-to-bottom.
export const LINE_MIN = 2.5, LINE_FADE = 0.5, LINE_MAX = 3;

// push(lines, text, now): lines is a mutable array of { text, t0, count }.
// A repeat of a still-visible line bumps its count and refreshes its timer.
export function pushLine(lines, text, now) {
  const old = lines.find((l) => l.text === text && now - l.t0 < LINE_MIN + LINE_FADE);
  if (old) { old.count++; old.t0 = now; return lines; }
  lines.push({ text, t0: now, count: 1 });
  while (lines.length > LINE_MAX) lines.shift();
  return lines;
}

// visible(lines, now): [{ text, alpha }] for the lines still on screen, in
// stack order. Expired lines are dropped from the array as a side effect.
export function visibleLines(lines, now) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (now - lines[i].t0 >= LINE_MIN + LINE_FADE) lines.splice(i, 1);
  }
  return lines.map((l) => {
    const age = now - l.t0;
    const alpha = age < LINE_MIN ? 1 : 1 - (age - LINE_MIN) / LINE_FADE;
    return { text: l.count > 1 ? `${l.text} ×${l.count}` : l.text, alpha };
  });
}
