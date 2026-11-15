// ⚙️ Settings for every page: language, theme and background image, in the site nav.
// Same localStorage keys as the main page; a change reloads the page.
if (!document.getElementById("settingsMenu") && !document.getElementById("pageSettings")) {
  const nav = document.querySelector(".site-nav");
  if (nav) {
    const KEYS = { lang: "ps2-elite-kd-lang", theme: "ps2-elite-kd-theme", bg: "ps2-elite-kd-bg-image" };
    const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
    const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} location.reload(); };
    const LANGS = [["en", "🇬🇧 English"], ["ja", "🇯🇵 日本語"], ["ru", "🇷🇺 Русский"], ["de", "🇩🇪 Deutsch"], ["fr", "🇫🇷 Français"], ["zh", "🇨🇳 中文"], ["es", "🇪🇸 Español"], ["uk", "🇺🇦 Українська"], ["it", "🇮🇹 Italiano"]];
    const css = document.createElement("style");
    css.textContent = `
#pageSettings { position: relative; margin-left: auto; }
#pageSettings > summary { list-style: none; cursor: pointer; padding: 10px; font-size: .85rem; color: var(--dim, #999); white-space: nowrap; }
#pageSettings > summary::-webkit-details-marker { display: none; }
#pageSettings[open] > summary, #pageSettings > summary:hover { color: var(--text, #eee); }
#pageSettings .ps-panel { position: absolute; right: 0; top: 100%; z-index: 80; width: min(17rem, 92vw); display: flex; flex-direction: column; gap: .5rem; padding: .65rem .7rem; background: var(--panel, #14161a); border: 2px solid var(--text, #eee); border-radius: 0; }
#pageSettings .ps-row { display: flex; align-items: center; justify-content: space-between; gap: .8rem; font-size: .88rem; color: var(--text, #eee); }
#pageSettings select, #pageSettings button { font: inherit; padding: .25rem .5rem; color: var(--text, #eee); background: var(--ctrl-btn-bg, #1e2430); border: 1px solid var(--border, #2a2e36); border-radius: 0; cursor: pointer; }`;
    document.head.append(css);
    const d = document.createElement("details");
    d.id = "pageSettings";
    d.innerHTML = `<summary title="Settings" aria-label="Settings">⚙️ Settings</summary><div class="ps-panel">
<div class="ps-row"><label for="psLang">Language</label><select id="psLang">${LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select></div>
<div class="ps-row"><span>Theme</span><button type="button" id="psTheme"></button></div>
<div class="ps-row"><span>Background</span><button type="button" id="psBg"></button></div></div>`;
    nav.append(d);
    const lang = d.querySelector("#psLang"), theme = d.querySelector("#psTheme"), bg = d.querySelector("#psBg");
    lang.value = get(KEYS.lang) || document.documentElement.lang || "en";
    const light = get(KEYS.theme) === "light", noBg = get(KEYS.bg) === "0";
    theme.textContent = light ? "☀️ Light" : "🌙 Dark";
    bg.textContent = noBg ? "Off" : "🖼️ On";
    lang.onchange = () => set(KEYS.lang, lang.value);
    theme.onclick = () => set(KEYS.theme, light ? "dark" : "light");
    bg.onclick = () => set(KEYS.bg, noBg ? "1" : "0");
  }
}
