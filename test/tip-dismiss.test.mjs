// Hint bubbles close early (owner t642u–t644u): keep the 5 s read time, but any
// scroll / wheel / finger drag, a tap elsewhere or the tab going hidden closes at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");

test("watchDismiss: scroll (after the opening grace), wheel, touchmove, outside tap, hidden tab", async () => {
  const win = new EventTarget(), doc = new EventTarget();
  doc.hidden = false;
  globalThis.window = win; globalThis.document = doc;
  try {
    const { watchDismiss, TIP_SCROLL_GRACE_MS } = await import("../tip-dismiss.mjs");
    assert.ok(TIP_SCROLL_GRACE_MS > 0 && TIP_SCROLL_GRACE_MS <= 400);
    let open = false, hides = 0;
    const bubble = { id: "bubble" };
    const opened = watchDismiss(() => open, () => { open = false; hides++; }, { inside: (t) => t === bubble, graceMs: 30 });
    const show = () => { open = true; opened(); };
    const ev = (type, target) => { const e = new Event(type); if (target) Object.defineProperty(e, "target", { value: target }); return e; };

    show(); win.dispatchEvent(ev("scroll")); assert.equal(open, true, "the opening tap's own scroll is ignored");
    await new Promise((r) => setTimeout(r, 40));
    doc.dispatchEvent(ev("scroll")); assert.equal(open, false, "a small scroll (window or inner box) closes it");
    show(); win.dispatchEvent(ev("wheel")); assert.equal(open, false, "wheel closes at once");
    show(); win.dispatchEvent(ev("touchmove")); assert.equal(open, false, "finger drag closes at once");
    show(); doc.dispatchEvent(ev("pointerdown", bubble)); assert.equal(open, true, "tap on the bubble keeps it");
    doc.dispatchEvent(ev("pointerdown", { id: "elsewhere" })); assert.equal(open, false, "tap elsewhere closes it");
    show(); doc.hidden = true; doc.dispatchEvent(ev("visibilitychange")); assert.equal(open, false, "tab hidden closes it");
    const n = hides; win.dispatchEvent(ev("wheel")); assert.equal(hides, n, "nothing to close when not open");
  } finally {
    delete globalThis.window; delete globalThis.document;
  }
});

test("bubbles wired to tip-dismiss; 5 s read time kept; dist tab tap replaces the old bubble", () => {
  const ht = read("head-tip.mjs");
  assert.match(ht, /export const HEAD_TIP_MS = 5000;/);
  assert.match(ht, /markOpened = watchDismiss\(/);
  assert.match(ht, /timer = setTimeout\(hideHeadTip, HEAD_TIP_MS\);\s*if \(markOpened\) markOpened\(\);/);
  const rk = read("rankings.mjs");
  assert.match(rk, /distTipOpened = watchDismiss\(\(\) => !\$\("distTip"\)\.hidden, hideTip,/);
  assert.match(rk, /tipBin = bi;\s*distTipOpened\(\);/);
  assert.match(rk, /function showDistHint\(\) \{[\s\S]*?if \(c && pill\) showHeadTip\(distHintText\(c\), pill\);/); // new tab → new bubble (re-show replaces)
  const np = read("name-peek.mjs");
  assert.match(np, /peekOpened = watchDismiss\(/);
  assert.match(np, /peekTimer = setTimeout\(hideNamePeek, PEEK_MS\);\s*peekOpened\(\);/);
  assert.doesNotMatch(read("tip-dismiss.mjs").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /animation|transition|classList/); // static
});
