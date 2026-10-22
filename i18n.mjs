// Site translation: the 🌐 language menu (index.html, #langSelect).
//
// One JSON file per language in i18n/ (i18n/en.json is the reference list of keys;
// see i18n/README.md for how humans edit them). English is the built-in text: the
// HTML already says it, and every t(key, fallback) call carries its English fallback,
// so a missing or empty translation shows English, never a raw key.
//
// Keep the import URL plain (no ?v= tag): index.html and app.js both import this file,
// and two URLs would make two module instances (see claude/working-setup.md).

/* Closed, the #langSelect shows the flag only (owner 2026-10-20: keeps the
 * field short); while the menu is open the options carry their names too —
 * the opened menu is huge, so there is room (see the ready block below).
 * `name` also serves the detected-language banner. */
export const LANGS = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "ja", name: "日本語", flag: "🇯🇵" },
  { code: "ru", name: "Русский", flag: "🇷🇺" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "uk", name: "Українська", flag: "🇺🇦" },
  { code: "it", name: "Italiano", flag: "🇮🇹" },
];

const STORE = "ps2-elite-kd-lang";
const ATTRS = [
  ["i18n", "textContent"],
  ["i18nHtml", "innerHTML"], // trusted HTML from i18n/*.json (links and bold inside a sentence); tests keep the tags identical
  ["i18nTitle", "title"],
  ["i18nAriaLabel", "aria-label"],
  ["i18nPlaceholder", "placeholder"],
  ["i18nTip", "data-tip"],
];
const SELECTOR = ATTRS.map(([ds]) => `[data-${ds.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}]`).join(",");

let lang = "en";
let table = {};
let seq = 0;
const originals = new WeakMap(); // element -> { prop: English text / attribute before the first translation }

/** Saved choice, else the first browser language we support, else English. */
export function pickLang(saved, navLangs = []) {
  const codes = LANGS.map((l) => l.code);
  if (codes.includes(saved)) return saved;
  for (const n of navLangs || []) {
    const primary = String(n || "").toLowerCase().split("-")[0];
    if (codes.includes(primary)) return primary;
  }
  return "en";
}

/** Replace {name} placeholders with vars.name; unknown placeholders stay as written. */
export function fill(text, vars) {
  if (!vars) return String(text);
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Translation for key in the current language, else the English fallback, else the key. */
export function t(key, fallback, vars) {
  const s = lang !== "en" ? table[key] : undefined;
  return fill(typeof s === "string" && s ? s : (fallback ?? key), vars);
}

function put(el, prop, key) {
  let saved = originals.get(el);
  if (!saved) originals.set(el, (saved = {}));
  if (!(prop in saved)) saved[prop] = prop === "textContent" ? el.textContent : prop === "innerHTML" ? el.innerHTML : el.getAttribute(prop);
  const s = lang !== "en" ? table[key] : undefined;
  const value = typeof s === "string" && s ? s : saved[prop];
  if (prop === "textContent") el.textContent = value;
  else if (prop === "innerHTML") el.innerHTML = value;
  else if (value == null) el.removeAttribute(prop);
  else el.setAttribute(prop, value);
}

/** Write the current language into every element marked data-i18n* (text, title, aria-label, placeholder). */
export function apply(root = document) {
  for (const el of root.querySelectorAll(SELECTOR)) {
    for (const [ds, prop] of ATTRS) {
      if (el.dataset[ds] != null) put(el, prop, el.dataset[ds]);
    }
  }
}

async function load(code) {
  try {
    const r = await fetch(new URL(`i18n/${code}.json`, import.meta.url), { cache: "no-cache" });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

/** Switch language. Falls back to English if the file can't be loaded. Returns the language now shown. */
export async function setLang(code) {
  const mine = ++seq;
  let want = LANGS.some((l) => l.code === code) ? code : "en";
  let tb = want === "en" ? {} : await load(want);
  if (mine !== seq) return lang;            // a newer choice came in while this one loaded
  if (want !== "en" && !tb) { want = "en"; tb = {}; }
  lang = want;
  table = tb;
  document.documentElement.lang = lang;
  apply();
  const sel = document.getElementById("langSelect");
  if (sel && sel.value !== lang) sel.value = lang;
  window.dispatchEvent(new CustomEvent("ps2-lang", { detail: lang }));
  return lang;
}

export function currentLang() {
  return lang;
}

function savedLang() {
  try { return localStorage.getItem(STORE); } catch { return null; }
}

function saveLang(code) {
  try { localStorage.setItem(STORE, code); } catch {}
}

const BANNER_FLAG = "ps2-elite-kd-lang-banner";

/** One-time notice when the language was picked from the browser (nothing saved yet): says which
 *  language is shown, that the 🌐 menu changes it, and offers English in one click. Only when that
 *  language really has translations, and never again after it is dismissed or a choice is saved. */
function showDetectedBanner() {
  try {
    if (savedLang() || lang === "en" || !Object.keys(table).length) return;
    if (localStorage.getItem(BANNER_FLAG)) return;
  } catch { return; }
  const name = (LANGS.find((l) => l.code === lang) || {}).name || lang;
  const bar = document.createElement("div");
  bar.id = "langBanner";
  bar.setAttribute("role", "status");
  bar.style.cssText = "display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:center;padding:8px 40px 8px 16px;position:relative;background:var(--card,var(--bg));color:var(--text);border-bottom:1px solid var(--border);font-size:14px;line-height:1.4;text-align:center";
  const msg = document.createElement("span");
  msg.textContent = t("banner.text", "Showing this page in {lang}. Change it anytime with the 🌐 menu.", { lang: name });
  const en = document.createElement("button");
  en.type = "button";
  en.textContent = "English";
  en.style.cssText = "cursor:pointer;font:inherit;color:var(--accent);background:none;border:1px solid var(--border);border-radius:6px;padding:2px 10px";
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "×";
  x.setAttribute("aria-label", t("banner.close", "Dismiss"));
  x.style.cssText = "position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;font:inherit;font-size:20px;line-height:1;color:var(--muted);background:none;border:0;padding:4px 8px";
  const hide = () => { try { localStorage.setItem(BANNER_FLAG, "1"); } catch {} bar.remove(); };
  en.addEventListener("click", () => { saveLang("en"); hide(); location.reload(); });
  x.addEventListener("click", hide);
  bar.append(msg, en, x);
  document.body.prepend(bar);
}

/** Resolves once the first language is applied (app.js waits for it, so its own text is translated too). */
export const ready = typeof document === "undefined" ? Promise.resolve("en") : (async () => {
  const first = pickLang(savedLang(), typeof navigator !== "undefined" ? navigator.languages : []);
  const sel = document.getElementById("langSelect");
  if (sel) {
    // Reload on change: text that other scripts already rendered (tables, rankings) can't be re-translated in place.
    sel.addEventListener("change", () => {
      saveLang(sel.value);
      location.reload();
    });
    // Owner 2026-10-20 evening: the options always read "🇩🇪 Deutsch" —
    // full language name in the selection, open or closed.
    for (const opt of sel.options) {
      const l = LANGS.find((x) => x.code === opt.value);
      if (l) opt.textContent = `${l.flag} ${l.name}`;
    }
  }
  const shown = await setLang(first);
  if (document.body) showDetectedBanner(); else document.addEventListener("DOMContentLoaded", showDetectedBanner, { once: true });
  return shown;
})();

if (typeof window !== "undefined") window.ps2I18n = { t, setLang, currentLang, LANGS };
