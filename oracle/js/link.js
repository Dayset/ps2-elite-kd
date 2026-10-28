// #82: second-device sign-in, the DOM-free part (Node tests import it).
// The PC shows a one-time link as a QR code; the phone opens oracle/#link=<code>.
// The code rides in the #fragment, so it never reaches GitHub Pages or Worker logs;
// the page strips it from the address bar before it does anything else.
import qrcode from "./vendor/qrcode.mjs?v=20261028-qr1";

const CODE_RE = /^[A-Za-z0-9_-]{40,48}$/;

/** "#link=<code>" (alone or among other #params) -> the code, or "" when there is none / it is malformed. */
export function linkCodeFromHash(hash) {
  const m = /(?:^#|[#&])link=([^&]*)/.exec(String(hash || ""));
  const code = m ? decodeURIComponent(m[1]) : "";
  return CODE_RE.test(code) ? code : "";
}

/** The hash with the link parameter removed ("" when nothing else was in it). */
export function hashWithoutLink(hash) {
  const rest = String(hash || "").replace(/^#/, "").split("&").filter((p) => p && !p.startsWith("link="));
  return rest.length ? "#" + rest.join("&") : "";
}

/** Scalable SVG of the QR code (black on white, 4-module quiet zone) for a link. */
export function qrSvg(text, title = "") {
  const q = qrcode(0, "M");
  q.addData(String(text));
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 16, scalable: true, title: title || undefined });
}
