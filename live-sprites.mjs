/**
 * 🎥 Live emoji meters drawn ONCE into images (owner 2026-10-24: the overlay used ~25 % of a 9850X3D).
 *
 * Before: every emoji was three text copies, two of them through SVG filters (#lvOutline: dilate + blur;
 * #lvHollow: erode), under endlessly pulsing drop-shadow glows, so the browser re-ran those filters on every
 * frame (headless check: ~80 % of one core with the overlay just sitting there).
 * Now each emoji is drawn once per size (and screen pixel density) into a few images:
 *   base  = the black outline ring (t579u/t581u, OUTLINE_PX) + the hollow empty part (t589u: dark greyscale
 *           FILL_DIM interior inside a HOLLOW_PX light inner ring),
 *   solid = the full-colour emoji (the fill, shown from the bottom up to the level),
 *   glow1..3 = the t568u tier halos (green / blue / gold), now steady instead of pulsing,
 * and the overlay only shows these images; the fill moves them with transforms (no repaint per frame).
 * The pure alpha helpers are exported for the tests; the canvas part runs only in a browser.
 */

/** Pixel offsets inside a disk of radius r (≥ 0): the round brush for dilate / erode. */
export function disk(r) {
  const out = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r + 1e-9) out.push(dx, dy);
  return out;
}

/** Grow an alpha mask (Uint8 0–255, w × h) by r pixels: each pixel = the max inside the disk. */
export function dilate(a, w, h, r) {
  const off = disk(r);
  const out = new Uint8ClampedArray(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = 0; k < off.length && m < 255; k += 2) {
        const xx = x + off[k], yy = y + off[k + 1];
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { const v = a[yy * w + xx]; if (v > m) m = v; }
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Shrink an alpha mask by r pixels: each pixel = the min inside the disk (outside the image counts as 0). */
export function erode(a, w, h, r) {
  const off = disk(r);
  const out = new Uint8ClampedArray(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = a[y * w + x];
      for (let k = 0; k < off.length && m > 0; k += 2) {
        const xx = x + off[k], yy = y + off[k + 1];
        const v = xx >= 0 && yy >= 0 && xx < w && yy < h ? a[yy * w + xx] : 0;
        if (v < m) m = v;
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Gaussian blur of an alpha mask (separable, standard deviation sigma in pixels). */
export function blurAlpha(a, w, h, sigma) {
  if (!(sigma > 0)) return Uint8ClampedArray.from(a);
  const R = Math.max(1, Math.ceil(sigma * 3));
  const k = [];
  let sum = 0;
  for (let i = -R; i <= R; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -R; i <= R; i++) { const xx = x + i; if (xx >= 0 && xx < w) s += a[y * w + xx] * k[i + R]; }
    tmp[y * w + x] = s;
  }
  const out = new Uint8ClampedArray(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -R; i <= R; i++) { const yy = y + i; if (yy >= 0 && yy < h) s += tmp[yy * w + x] * k[i + R]; }
    out[y * w + x] = s;
  }
  return out;
}

/** The ink box of a mask: { x, y, w, h } of the pixels above thr, or null when nothing is drawn. */
export function inkBox(a, w, h, thr = 24) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The outline ring (t581u look: grown by outline px, softened a little, cut back to a hard edge with a steep
 * alpha ramp, the emoji itself cut out) and the smooth silhouette it hugs (used for the glow).
 * a = the emoji's alpha; returns { ring, shape } (alpha masks).
 */
export function outlineMasks(a, w, h, outline, soft) {
  const grown = blurAlpha(dilate(a, w, h, outline), w, h, soft);
  const shape = new Uint8ClampedArray(a.length);
  const ring = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) {
    const s = Math.max(0, Math.min(255, grown[i] * 4 - 255)); // feFuncA slope 4, intercept −1
    shape[i] = Math.max(s, a[i]);
    ring[i] = Math.round((s * (255 - a[i])) / 255); // the emoji cut out of it
  }
  return { ring, shape };
}

/** The light inner ring of the hollow part (t589u): the emoji's own edge, hollow px deep. A fractional depth
 *  (1.75 px) blends the two whole-pixel rings around it, so the ring is as thick as asked at any screen density. */
export function hollowRim(a, w, h, hollow) {
  const lo = Math.floor(hollow), t = hollow - lo;
  const inLo = erode(a, w, h, lo);
  const inHi = t > 0 ? erode(a, w, h, lo + 1) : inLo;
  const rim = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) {
    const inner = inLo[i] * (1 - t) + inHi[i] * t;
    rim[i] = Math.round((a[i] * (255 - inner)) / 255);
  }
  return rim;
}

/* ---------------- browser part ---------------- */

const over = (d, i, r, g, b, a) => {
  // straight-alpha "source over" of colour (r, g, b, a 0–1) onto pixel i of RGBA array d
  if (a <= 0) return;
  const da = d[i + 3] / 255, oa = a + da * (1 - a);
  d[i] = (r * a + d[i] * da * (1 - a)) / oa;
  d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
  d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
  d[i + 3] = oa * 255;
};
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c)); const n = m ? parseInt(m[1], 16) : 0xe6e6e6; return [n >> 16, (n >> 8) & 255, n & 255]; };
const toUrl = (cv) => new Promise((res) => {
  try { cv.toBlob((b) => res(b ? URL.createObjectURL(b) : cv.toDataURL("image/png")), "image/png"); } catch { res(""); }
});

/**
 * Draw one emoji's images. opts: { fontPx, dpr, family, outlinePx, hollowPx, dim, hollowInk, glows }
 *   glows = [[{ blur (css px), color: [r, g, b], alpha }, …] per tier 1..3]
 * Returns { w, h, it, ih, gp (css px), base, solid, glow: [url1, url2, url3] } or null (nothing drawn).
 */
export async function drawEmojiSprite(e, opts) {
  const { fontPx, dpr = 1, family = "sans-serif", outlinePx = 2.25, hollowPx = 1.75, dim = 0.18, hollowInk = "#e6e6e6", glows = [] } = opts;
  const F = Math.max(8, Math.round(fontPx * dpr));
  // 1) the emoji on a roomy canvas, then its ink box
  const W0 = F * 3, H0 = F * 2;
  const c0 = document.createElement("canvas"); c0.width = W0; c0.height = H0;
  const x0 = c0.getContext("2d", { willReadFrequently: true });
  x0.font = `400 ${F}px ${family}`; x0.textBaseline = "alphabetic"; x0.textAlign = "left";
  x0.fillText(e, F * 0.5, F * 1.45);
  const src = x0.getImageData(0, 0, W0, H0).data;
  const a0 = new Uint8ClampedArray(W0 * H0);
  for (let i = 0; i < a0.length; i++) a0[i] = src[i * 4 + 3];
  const box = inkBox(a0, W0, H0);
  if (!box) return null;
  // 2) crop with room for the outline (base/solid) and for the halos (glow)
  const pad = Math.ceil((outlinePx + 2) * dpr);
  const maxBlur = Math.max(0, ...glows.flat().map((g) => g.blur || 0));
  const gpad = pad + Math.ceil(maxBlur * 1.6 * dpr);
  const w = box.w + pad * 2, h = box.h + pad * 2;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const a = new Uint8ClampedArray(w * h);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const s = ((box.y + y) * W0 + box.x + x) * 4, t = (y + pad) * w + x + pad;
    rgba.set(src.subarray(s, s + 4), t * 4);
    a[t] = src[s + 3];
  }
  const { ring, shape } = outlineMasks(a, w, h, outlinePx * dpr, 0.7 * dpr);
  const rim = hollowRim(a, w, h, hollowPx * dpr);
  const [ir, ig, ib] = hex(hollowInk);
  const base = new Uint8ClampedArray(w * h * 4);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    over(base, i, 0, 0, 0, ring[p] / 255); // black outline ring
    if (a[p]) {
      const g = 0.13 * rgba[i] + 0.43 * rgba[i + 1] + 0.04 * rgba[i + 2]; // #lvHollow colour matrix
      over(base, i, g, g, g, (dim * a[p]) / 255); // dark greyscale interior, FILL_DIM visible
      over(base, i, ir, ig, ib, rim[p] / 255); // light inner ring
    }
  }
  const put = (data, cw, ch) => { const c = document.createElement("canvas"); c.width = cw; c.height = ch; c.getContext("2d").putImageData(new ImageData(data, cw, ch), 0, 0); return c; };
  const baseCv = put(base, w, h);
  const solidCv = put(rgba, w, h);
  // 3) halos: a soft shadow of the outlined silhouette, outside it only (the hollow inside stays clean)
  const shp = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) shp[p * 4 + 3] = shape[p];
  const shapeCv = put(shp, w, h);
  const gw = w + (gpad - pad) * 2, gh = h + (gpad - pad) * 2, off = gpad - pad;
  const glowCvs = glows.map((layers) => {
    const c = document.createElement("canvas"); c.width = gw; c.height = gh;
    const x = c.getContext("2d");
    const far = gw * 4; // draw the shape off-canvas, keep only its shadow
    for (const L of layers || []) {
      const [r, g, b] = L.color;
      x.shadowColor = `rgba(${r},${g},${b},${L.alpha})`;
      x.shadowBlur = L.blur * dpr; // canvas blur = 2σ, like CSS drop-shadow's radius
      x.shadowOffsetX = far;
      x.drawImage(shapeCv, off - far, off);
    }
    x.shadowColor = "transparent";
    x.globalCompositeOperation = "destination-out";
    x.drawImage(shapeCv, off, off);
    return c;
  });
  const [baseUrl, solidUrl, ...glowUrls] = await Promise.all([toUrl(baseCv), toUrl(solidCv), ...glowCvs.map(toUrl)]);
  return { w: w / dpr, h: h / dpr, it: pad / dpr, ih: box.h / dpr, gp: off / dpr, base: baseUrl, solid: solidUrl, glow: glowUrls };
}

/** CSS for a set of drawn emojis: class lv-x<i> per emoji (sizes + images), glows per tier class on the unit. */
export function spriteCss(list) {
  const px = (v) => `${Math.round(v * 1000) / 1000}px`;
  const out = [];
  list.forEach((s, i) => {
    if (!s) return;
    out.push(`.lv-x${i}{--sw:${px(s.w)};--sh:${px(s.h)};--it:${px(s.it)};--ih:${px(s.ih)};--gp:${px(s.gp)}}`);
    out.push(`.lv-x${i}>.lv-b{background-image:url("${s.base}")}`);
    out.push(`.lv-x${i}>.lv-sw>.lv-s{background-image:url("${s.solid}")}`);
    s.glow.forEach((u, t) => { if (u) out.push(`.lv-g${t + 1}>.lv-x${i}>.lv-gl{background-image:url("${u}")}`); });
  });
  return out.join("\n");
}
