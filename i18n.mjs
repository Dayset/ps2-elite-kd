// Site translation: the 🌐 language menu (index.html, #langSelect).
//
// One JSON file per language in i18n/ (i18n/en.json is the reference list of keys;
// see i18n/README.md for how humans edit them). English is the built-in text: the
// HTML already says it, and every t(key, fallback) call carries its English fallback,
// so a missing or empty translation shows English, never a raw key.
//
// Keep the import URL plain (no ?v= tag): index.html and app.js both import this file,
// and two URLs would make two module instances (see claude/working-setup.md).

export const LANGS = [
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
  { code: "ru", name: "Русский" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "zh", name: "中文" },
  { code: "es", name: "Español" },
];

const STORE = "ps2-elite-kd-lang";
const ATTRS = [
  ["i18n", "textContent"],
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
  if (!(prop in saved)) saved[prop] = prop === "textContent" ? el.textContent : el.getAttribute(prop);
  const s = lang !== "en" ? table[key] : undefined;
  const value = typeof s === "string" && s ? s : saved[prop];
  if (prop === "textContent") el.textContent = value;
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
  }
  return setLang(first);
})();

if (typeof window !== "undefined") window.ps2I18n = { t, setLang, currentLang, LANGS };
