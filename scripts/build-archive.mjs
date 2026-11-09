/**
 * Build the Archive section from archive/src/ (the CMDRCyrious / Iridar archive).
 *
 * Source of truth (committed in the repo, so a fresh clone can rebuild):
 *   archive/src/INDEX.md   — the archive's own inventory (Part 2 table: file, title,
 *                              words, source, notes) and lost list (Part 4)
 *   archive/src/*.md       — one markdown file per archived page (164), each with a
 *                              provenance bullet block (source, snapshot, saved) and a
 *                              trafilatura front-matter block (title, author, url, date)
 *   archive/core.json      — hand-written: currency marks, raw-source mapping, video records
 *   archive/Iridars-Toolbox-v6h.zip, archive/raw/* — the downloadable spreadsheet and the
 *                              original source HTML for the core pages (copied once from the
 *                              preservation master at ~/workspace/cmdrcyrious-archive/)
 *
 * Outputs (all committed):
 *   archive/pages/<slug>.html — one rendered page per archived page (164) + 2 video records
 *   archive/index.json        — machine-readable inventory (166 entries + Toolbox download)
 *   archive.html              — the inventory table and lost list, injected between markers
 *
 * Run:  node scripts/build-archive.mjs           (writes the outputs)
 *       node scripts/build-archive.mjs --check    (renders to memory, exits 1 if the
 *                                                  committed output differs)
 *
 * Rules the generator follows (see the task: the archive is a preservation record):
 *  - Attribution on every page: original author, original source URL, original date,
 *    snapshot/archive date. Where the source does not record an author, the page says
 *    so — nothing is invented. Titles that name their author ("Claymore Guide by
 *    Bvllish") are read as the source's own words.
 *  - Lost pages are rendered as stubs (title + what survives), never as articles.
 *  - Images were not preserved in the archive (only their URLs survive), so the
 *    renderer never emits an <img>: it emits a placeholder with the original URL.
 *    The site loads no third-party resources (PRIVACY.md); article bodies link out
 *    with <a> only, never hotlink.
 *  - No timestamps in generated output: every date comes from the source files.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ARCHIVE_PIN = "20261109-archive1";
export const STYLES_PIN = "20261108-g2f1";
export const ARCHIVE_DATE = "2026-11-09";
export const ARCHIVE_DIR = "archive";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(root, ARCHIVE_DIR, "src");
const PAGES_DIR = path.join(root, ARCHIVE_DIR, "pages");
const INDEX_HTML = path.join(root, "archive.html");
const INDEX_JSON = path.join(root, ARCHIVE_DIR, "index.json");

/** Currency marks (archive vocabulary — the INDEX defines them; kept in English). */
export const MARKS = {
  verified: { icon: "✅", label: "Verified working (2026)" },
  timeless: { icon: "🕰️", label: "Method timeless, data dated" },
  outdated: { icon: "⚠️", label: "Largely outdated" },
  dead: { icon: "💀", label: "Dead (kept for history)" },
  lost: { icon: "❌", label: "Lost" },
  pending: { icon: "⏳", label: "Pending" },
  mixed: { icon: "⚠️", label: "Mixed" },
};

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cleanBulletValue(v) {
  return String(v || "").trim();
}

/** "https://x/ — live copy returns HTTP 200..." -> "https://x/" (first token before " — "). */
function firstUrl(v) {
  const s = cleanBulletValue(v);
  if (!s) return "";
  const cut = s.split(" — ")[0].split(" (")[0].trim();
  return /^https?:\/\//.test(cut) ? cut : "";
}

function firstDate(v) {
  const m = String(v || "").match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}

function waybackDate(url) {
  const m = String(url || "").match(/web\.archive\.org\/web\/(\d{8})(\d{6})?/);
  if (!m) return "";
  const d = m[1];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/**
 * Parse one archive markdown file.
 * Layout: "# Title", provenance bullets, "---", optional front-matter "---" block, body.
 * Halospud / angular-size files have bullets but no front-matter block.
 */
export function parsePageFile(text, slug) {
  const src = String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  let title = "";
  let i = 0;
  if (lines[0] && lines[0].startsWith("# ")) {
    title = lines[0].slice(2).trim();
    i = 1;
  }
  // Provenance bullets up to the first "---" line.
  const bullets = {};
  while (i < lines.length && lines[i].trim() !== "---") {
    const m = lines[i].match(/^-\s+\*\*([^*]+)\*\*:?\s*(.*)$/);
    // The source writes the colon inside the bold ("**Source:** url"), so the key
    // arrives with a trailing ":" — strip it so lookups use plain key names.
    if (m) bullets[m[1].trim().replace(/:$/, "")] = cleanBulletValue(m[2]);
    i++;
  }
  // Skip the "---"; if the next non-blank line is "---", a front-matter block follows.
  i++;
  while (i < lines.length && !lines[i].trim()) i++;
  const front = {};
  if (lines[i] && lines[i].trim() === "---") {
    i++;
    while (i < lines.length && lines[i].trim() !== "---") {
      const m = lines[i].match(/^([A-Za-z_]+):\s*(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        front[m[1]] = v;
      }
      i++;
    }
    i++; // closing "---"
  }
  const body = lines.slice(i).join("\n").trim();
  return { slug, title: front.title || title || slug, bullets, front, body };
}

/** Parse the INDEX.md Part 2 inventory table and Part 4 lost table. */
export function parseIndex(text) {
  const inventory = new Map(); // file -> {title, words, source, notes}
  const lost = new Map(); // file -> {what, survives}
  for (const line of String(text).split("\n")) {
    let m = line.match(/^\| `([^`]+)` \| ([^|]+) \| (\d+) \| ([^|]+) \| ([^|]*) \|$/);
    if (m && m[1].endsWith(".md") && !m[1].startsWith("pages/")) {
      inventory.set(m[1], { title: m[2].trim(), words: Number(m[3]), source: m[4].trim(), notes: m[5].trim() });
      continue;
    }
    m = line.match(/^\| `pages\/([^`]+)` \| ([^|]+) \| ([^|]+) \|$/);
    if (m && m[1].endsWith(".md")) lost.set(m[1], { what: m[2].trim(), survives: m[3].trim() });
  }
  return { inventory, lost };
}

function resolveUrl(base, href) {
  if (!href || /^(https?:|mailto:|#|data:)/i.test(href)) return href;
  if (!base) return href;
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function imagePlaceholder(alt, url, baseUrl, block) {
  const resolved = resolveUrl(baseUrl, url);
  const label = esc(alt || "Image");
  const inner = `<span class="arc-img-mark" aria-hidden="true">🖼️</span> <span class="arc-img-alt">${label}</span> — <span data-i18n="arc.imgNotSaved">Image not preserved in the archive.</span> <a href="${esc(resolved)}" target="_blank" rel="noopener noreferrer" data-i18n="arc.imgOriginal">Original</a>`;
  return block ? `<figure class="arc-img">${inner}</figure>` : `<span class="arc-img-inline">${inner}</span>`;
}

function linkHtml(text, url, baseUrl) {
  const href = resolveUrl(baseUrl, url);
  const ext = /^(https?:)?\/\//i.test(href) ? ` target="_blank" rel="noopener noreferrer"` : "";
  return `<a href="${esc(href)}"${ext}>${text}</a>`;
}

/** Inline markdown: code, images, links, bold, italic. Input is escaped first. */
export function inlineMd(text, baseUrl) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => imagePlaceholder(alt, url, baseUrl, false));
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, url) => linkHtml(t, url, baseUrl));
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return s;
}

function renderTable(headRow, rows, baseUrl) {
  const cell = (row, tag) => row.map((c) => `<${tag}>${inlineMd(c.trim(), baseUrl)}</${tag}>`).join("");
  const head = `<thead><tr>${cell(headRow, "th")}</tr></thead>`;
  const body = `<tbody>${rows.map((r) => `<tr>${cell(r, "td")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

/** Minimal markdown renderer for trafilatura output: headings, lists, quotes, tables, hr, paragraphs. */
export function mdToHtml(md, baseUrl) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const isSpecial = (l) =>
    !l.trim() ||
    /^#{1,6}\s/.test(l) ||
    /^---+$/.test(l.trim()) ||
    /^>\s?/.test(l) ||
    /^(\s*)([-*]|\d+[.)])\s+/.test(l) ||
    /^```/.test(l) ||
    (l.trim().startsWith("|") && lines[i + 1] && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim()));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = Math.max(2, hm[1].length); // body h1 demoted: the page already has its h1
      out.push(`<h${lvl}>${inlineMd(hm[2], baseUrl)}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push("<hr />");
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim().startsWith("|") && lines[i + 1] && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const head = line.trim().replace(/^\||\|$/g, "").split("|");
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|"));
        i++;
      }
      out.push(renderTable(head, rows, baseUrl));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${mdToHtml(q.join("\n"), baseUrl)}</blockquote>`);
      continue;
    }
    const lm = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
    if (lm) {
      // Flat list with one nesting level (2+ spaces indent). Consecutive lines only.
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        items.push({ depth: m[1].length >= 2 ? 1 : 0, ordered: /^\d/.test(m[2]), text: m[3] });
        i++;
      }
      const renderItems = (list, start) => {
        let html = "";
        let j = start;
        const tag = list[j] && list[j].ordered ? "ol" : "ul";
        html += `<${tag}>`;
        while (j < list.length && list[j].depth === 0) {
          let li = inlineMd(list[j].text, baseUrl);
          j++;
          if (j < list.length && list[j].depth === 1) {
            const sub = [];
            while (j < list.length && list[j].depth === 1) sub.push(list[j++]);
            const subTag = sub[0].ordered ? "ol" : "ul";
            li += `<${subTag}>${sub.map((s) => `<li>${inlineMd(s.text, baseUrl)}</li>`).join("")}</${subTag}>`;
          }
          html += `<li>${li}</li>`;
        }
        html += `</${tag}>`;
        return html;
      };
      out.push(renderItems(items, 0));
      continue;
    }
    if (/^!\[([^\]]*)\]\(([^)]+)\)\s*$/.test(line.trim())) {
      const m = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      out.push(imagePlaceholder(m[1], m[2], baseUrl, true));
      i++;
      continue;
    }
    // Paragraph: consecutive plain lines.
    const buf = [line];
    i++;
    while (i < lines.length && !isSpecial(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inlineMd(buf.join(" "), baseUrl)}</p>`);
  }
  return out.join("\n");
}

/** Author: front matter, else the Author bullet, else the title's own "by X" / "X's". */
export function deriveAuthor(parsed) {
  const { front, bullets, title } = parsed;
  // Front-matter author is trafilatura-extracted: one file yields "U; Mpchebe" (an
  // extraction artifact, not a name), so reject anything that is not a plain
  // handle/name. The bullets Author (hand-written by the archivist) is trusted as-is.
  // "Institoros" is Iridar's handle (INDEX Part 1: "Iridar (Institoros)") — show both.
  if (front.author && /^[A-Za-z0-9 _.'-]+$/.test(front.author)) {
    return front.author === "Institoros" ? "Iridar (Institoros)" : front.author;
  }
  if (bullets["Author"]) return bullets["Author"];
  const by = title.match(/\bby\s+([A-Z][A-Za-z0-9_.-]+)\s*$/);
  if (by) return by[1];
  const poss = title.match(/^([A-Z][A-Za-z0-9_.-]+)'s\s/);
  if (poss) return poss[1];
  // "Halospud — Planetside 2 Infantry Guide, Part 2: …" — the name before the em dash.
  const dash = title.match(/^([A-Z][A-Za-z0-9_.-]+) — /);
  if (dash) return dash[1];
  return "";
}

function publisherFor(url) {
  if (!url) return "CMDRCyrious.com";
  if (url.includes("docs.google.com")) return "Google Docs";
  if (url.includes("reddit.com")) return "Reddit (r/Planetside)";
  if (url.includes("web.archive.org")) return "Wayback Machine";
  if (url.includes("iridar-mirror")) return "Iridar mirror (iridar-mirror.knyazev.io)";
  return "CMDRCyrious.com";
}

function sourceLabel(invSource, slug) {
  if (slug === "angular-size-reddit-post") return "Hand-saved (MHTML)";
  switch ((invSource || "").toLowerCase()) {
    case "live":
      return "Live";
    case "wayback":
      return "Wayback";
    case "mirror":
      return "Mirror";
    case "google docs":
      return "Google Docs";
    default:
      return invSource || "Live";
  }
}

/** Merge one markdown file + INDEX row + core.json into an entry. */
export function buildEntry(slug, parsed, invRow, lostRow, core) {
  const { bullets, front, body } = parsed;
  const originalUrl =
    firstUrl(bullets["Source (live)"]) ||
    firstUrl(bullets["Source"]) ||
    (front.url && !front.url.includes("web.archive.org") ? front.url : "") ||
    front.url ||
    "";
  const archivedUrl = firstUrl(bullets["Source (archived)"]) || (front.url && front.url.includes("web.archive.org") ? front.url : "");
  const snapshotDate = bullets["Snapshot date"] || waybackDate(archivedUrl) || "";
  const date = front.date || firstDate(bullets["Posted"]) || "";
  const saved = firstDate(bullets["Saved"]) || ARCHIVE_DATE;
  const words = invRow ? invRow.words : body.split(/\s+/).filter(Boolean).length;
  const currency = core.currency[slug] || null;
  const isLost = Boolean(lostRow) || /LOST/.test(bullets["Status"] || "") || Boolean(bullets["LOST (2026-11-09)"]);
  return {
    slug,
    page: `archive/pages/${slug}.html`,
    title: parsed.title,
    author: deriveAuthor(parsed),
    publisher: publisherFor(originalUrl),
    originalUrl,
    archivedUrl,
    date,
    snapshotDate,
    saved,
    words,
    source: sourceLabel(invRow ? invRow.source : "", slug),
    sourceNote: invRow ? invRow.notes : "",
    status: isLost ? "lost" : "ok",
    currency: currency ? currency.mark : null,
    currencyNote: currency ? currency.note : "",
    description: front.description || "",
    what: lostRow ? lostRow.what : "",
    survives: lostRow ? lostRow.survives : "",
    raw: (core.raw[slug] || []).filter(Boolean),
    body,
  };
}

export function loadCore() {
  return JSON.parse(readFileSync(path.join(root, ARCHIVE_DIR, "core.json"), "utf8"));
}

export function buildEntries() {
  const core = loadCore();
  const { inventory, lost } = parseIndex(readFileSync(path.join(SRC_DIR, "INDEX.md"), "utf8"));
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".md") && f !== "INDEX.md").sort();
  const entries = [];
  const problems = [];
  // Captured after the INDEX was written (2026-11-09, 09:38): the Angular Size post
  // was saved by hand as a browser MHTML snapshot while the INDEX still says "pending".
  const KNOWN_EXTRA = new Set(["angular-size-reddit-post.md"]);
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const parsed = parsePageFile(readFileSync(path.join(SRC_DIR, file), "utf8"), slug);
    const invRow = inventory.get(file) || null;
    if (!invRow && !KNOWN_EXTRA.has(file)) problems.push(`${file}: not in the INDEX inventory table`);
    entries.push(buildEntry(slug, parsed, invRow, lost.get(file) || null, core));
  }
  for (const file of inventory.keys()) {
    if (!files.includes(file)) problems.push(`${file}: in the INDEX inventory table but no markdown file`);
  }
  for (const slug of Object.keys(core.currency)) {
    if (!entries.some((e) => e.slug === slug)) problems.push(`core.json currency for missing slug ${slug}`);
  }
  for (const [slug, raws] of Object.entries(core.raw)) {
    for (const r of raws) {
      if (!existsSync(path.join(root, ARCHIVE_DIR, "raw", r))) problems.push(`core.json raw file missing: ${r} (for ${slug})`);
    }
  }
  // The two video records (Part 1, no markdown file — no video file is stored).
  for (const v of core.videos || []) {
    entries.push({
      slug: v.slug,
      page: `archive/pages/${v.slug}.html`,
      title: v.title,
      author: v.author,
      publisher: v.channel,
      originalUrl: v.url,
      archivedUrl: "",
      date: v.date,
      snapshotDate: "",
      saved: ARCHIVE_DATE,
      words: 0,
      source: "YouTube (record only)",
      sourceNote: "",
      status: "video",
      currency: v.currency || null,
      currencyNote: v.note || "",
      description: v.summary || "",
      what: "",
      survives: "",
      raw: [],
      body: "",
      summary: v.summary || "",
    });
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
  return { entries, core, problems };
}

const LANG_SELECT = `<select id="langSelect" class="lang-select" title="Language" aria-label="Language" data-i18n-title="lang.label" data-i18n-aria-label="lang.label">
        <option value="en" selected>🇬🇧 English</option>
        <option value="ja">🇯🇵 日本語</option>
        <option value="ru">🇷🇺 Русский</option>
        <option value="de">🇩🇪 Deutsch</option>
        <option value="fr">🇫🇷 Français</option>
        <option value="zh">🇨🇳 中文</option>
        <option value="es">🇪🇸 Español</option>
        <option value="uk">🇺🇦 Українська</option>
        <option value="it">🇮🇹 Italiano</option>
      </select>`;

const THEME_SNIPPET = `  <script>
    // Same theme key as the main page (set before paint).
    try {
      if (localStorage.getItem("ps2-elite-kd-theme") === "light") {
        document.documentElement.setAttribute("data-theme", "light");
      }
      if (localStorage.getItem("ps2-elite-kd-bg-image") === "0") {
        document.documentElement.classList.add("no-bg-image");
      }
    } catch (e) {}
  </script>`;

function badge(mark) {
  if (!mark || !MARKS[mark]) return "";
  const m = MARKS[mark];
  return `<span class="arc-badge arc-st-${mark}">${m.icon} ${m.label}</span>`;
}

function attrRows(entry) {
  const rows = [];
  const author = entry.author
    ? esc(entry.author)
    : `<span data-i18n="arc.attrUnknown">Not recorded in the source</span>`;
  rows.push(`<div><dt data-i18n="arc.attrAuthor">Author</dt><dd>${author}</dd></div>`);
  if (entry.originalUrl) {
    rows.push(`<div><dt data-i18n="arc.attrOriginal">Original</dt><dd><a href="${esc(entry.originalUrl)}" target="_blank" rel="noopener noreferrer">${esc(entry.originalUrl)}</a> (${esc(entry.publisher)})</dd></div>`);
  }
  rows.push(`<div><dt data-i18n="arc.attrDate">Original date</dt><dd>${entry.date ? esc(entry.date) : `<span data-i18n="arc.attrUnknown">Not recorded in the source</span>`}</dd></div>`);
  if (entry.snapshotDate) rows.push(`<div><dt data-i18n="arc.attrSnapshot">Snapshot date</dt><dd>${esc(entry.snapshotDate)}</dd></div>`);
  rows.push(`<div><dt data-i18n="arc.attrSaved">Archived</dt><dd>${esc(entry.saved)}</dd></div>`);
  rows.push(`<div><dt data-i18n="arc.attrSource">Source</dt><dd>${esc(entry.source)}</dd></div>`);
  if (entry.currency) {
    rows.push(`<div><dt data-i18n="arc.attrStatus">Status</dt><dd>${badge(entry.currency)}<p class="arc-attr-note">${esc(entry.currencyNote)}</p></dd></div>`);
  }
  if (entry.sourceNote) rows.push(`<div><dt data-i18n="arc.attrNote">Note</dt><dd>${esc(entry.sourceNote)}</dd></div>`);
  if (entry.raw.length) {
    const links = entry.raw.map((r) => `<a href="../raw/${esc(r)}" target="_blank" rel="noopener noreferrer">${esc(r)}</a>`).join(", ");
    rows.push(`<div><dt data-i18n="arc.attrRaw">Original source file</dt><dd>${links}</dd></div>`);
  }
  return rows.join("\n      ");
}

/** One rendered article page (or lost stub / video record). */
export function renderPage(entry) {
  const head = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="data:," />
  <title>${esc(entry.title)} — Archive — PS2 Elite</title>
${THEME_SNIPPET}
  <link rel="stylesheet" href="../styles.css?v=${STYLES_PIN}" />
  <link rel="stylesheet" href="../archive.css?v=${ARCHIVE_PIN}" />
</head>
<body class="site-page">
  <main class="arc-wrap">
    <header class="arc-page-head">
      <a class="arc-back" href="../archive.html" data-i18n="arc.backToArchive">← Back to the Archive</a>
      <h1>${esc(entry.title)}</h1>
      ${LANG_SELECT}
    </header>
    <section class="arc-attr" aria-label="About this page">
      <dl>
      ${attrRows(entry)}
      </dl>
    </section>`;
  const foot = `
    <footer class="arc-page-foot">
      <a href="../archive.html" data-i18n="arc.backToArchive">← Back to the Archive</a> · <a href="../index.html" data-i18n="arc.backToStats">PS2 Elite stats</a>
      <p data-i18n="arc.footNote">Preserved from the original — see the attribution above. PlanetSide 2 is © Daybreak Game Company. This archive preserves community writing for reference; it is not affiliated with Daybreak.</p>
    </footer>
  </main>
  <script type="module" src="../i18n.mjs"></script>
</body>
</html>`;
  if (entry.status === "lost") {
    const what = entry.description
      ? `<p class="arc-lost-desc">${esc(entry.description)}</p>`
      : "";
    return `${head}
    <section class="arc-lost" aria-label="Lost page">
      <h2><span data-i18n="arc.lostTitle">This page is lost</span></h2>
      <p data-i18n="arc.lostBody">The live copy returns HTTP 200 but its static HTML contains no article body, and no Wayback Machine snapshot of this URL exists. The article text is unrecoverable from any source tried.</p>
      <dl>
        <div><dt data-i18n="arc.lostWhat">What it was</dt><dd>${esc(entry.what || entry.title)}</dd></div>
        <div><dt data-i18n="arc.lostSurvives">What survives</dt><dd>${esc(entry.survives || "Title and page metadata only")}</dd></div>
      </dl>
      ${what}
    </section>${foot}`;
  }
  if (entry.status === "video") {
    return `${head}
    <section class="arc-video" aria-label="Video record">
      <p>${esc(entry.summary || "")}</p>
      <p data-i18n="arc.videoNoFile">No video file is stored in this archive. Watch it at the original link above while it still exists.</p>
    </section>${foot}`;
  }
  return `${head}
    <article class="arc-body">
${mdToHtml(entry.body, entry.originalUrl)}
    </article>${foot}`;
}

export function renderInventoryRows(entries) {
  return entries
    .map((e) => {
      const badgeHtml = e.status === "lost" ? badge("lost") : e.currency ? badge(e.currency) : "";
      const words = e.words ? String(e.words) : "—";
      return `          <tr data-title="${esc(e.title.toLowerCase())}" data-status="${e.status}" data-currency="${e.currency || ""}"><td><a href="${esc(e.page)}">${esc(e.title)}</a></td><td class="arc-num">${words}</td><td>${esc(e.source)}</td><td>${badgeHtml}</td></tr>`;
    })
    .join("\n");
}

export function renderLostSection(entries) {
  const lost = entries.filter((e) => e.status === "lost");
  return lost
    .map(
      (e) =>
        `          <li><a href="${esc(e.page)}">${esc(e.title)}</a> — ${esc(e.what || "")} (${esc(e.survives || "title only")})</li>`
    )
    .join("\n");
}

export function renderIndexJson(entries, core) {
  return {
    archiveDate: ARCHIVE_DATE,
    generatedBy: "scripts/build-archive.mjs",
    counts: {
      total: entries.length,
      readable: entries.filter((e) => e.status === "ok").length,
      lost: entries.filter((e) => e.status === "lost").length,
      videos: entries.filter((e) => e.status === "video").length,
    },
    toolbox: {
      file: `archive/${core.toolbox.file}`,
      title: core.toolbox.title,
      author: core.toolbox.author,
      date: core.toolbox.date,
      original: core.toolbox.original,
      currency: core.toolbox.currency,
      note: core.toolbox.note,
    },
    entries: entries.map((e) => ({
      slug: e.slug,
      page: e.page,
      title: e.title,
      author: e.author || null,
      publisher: e.publisher,
      originalUrl: e.originalUrl || null,
      archivedUrl: e.archivedUrl || null,
      date: e.date || null,
      snapshotDate: e.snapshotDate || null,
      saved: e.saved,
      words: e.words,
      source: e.source,
      status: e.status,
      currency: e.currency,
    })),
  };
}

const INV_START = "<!-- BEGIN ARCHIVE INVENTORY (generated by scripts/build-archive.mjs) -->";
const INV_END = "<!-- END ARCHIVE INVENTORY -->";
const LOST_START = "<!-- BEGIN ARCHIVE LOST LIST (generated by scripts/build-archive.mjs) -->";
const LOST_END = "<!-- END ARCHIVE LOST LIST -->";

export function injectSection(html, start, end, content) {
  const si = html.indexOf(start);
  const ei = html.indexOf(end, si + start.length);
  if (si < 0 || ei < 0) throw new Error(`build-archive: markers not found: ${start.slice(0, 40)}…`);
  return html.slice(0, si + start.length) + "\n" + content + "\n        " + html.slice(ei);
}

export function buildAll() {
  const { entries, core, problems } = buildEntries();
  if (problems.length) throw new Error(`build-archive: ${problems.join("; ")}`);
  if (!existsSync(path.join(root, ARCHIVE_DIR, core.toolbox.file))) {
    throw new Error(`build-archive: Toolbox zip missing: archive/${core.toolbox.file}`);
  }
  mkdirSync(PAGES_DIR, { recursive: true });
  const outputs = new Map(); // relative path -> content
  for (const e of entries) outputs.set(e.page, renderPage(e));
  outputs.set(path.join(ARCHIVE_DIR, "index.json"), JSON.stringify(renderIndexJson(entries, core), null, 2) + "\n");
  let home = readFileSync(INDEX_HTML, "utf8");
  home = injectSection(home, INV_START, INV_END, renderInventoryRows(entries));
  home = injectSection(home, LOST_START, LOST_END, renderLostSection(entries));
  outputs.set("archive.html", home);
  return { entries, core, outputs };
}

export function checkAll() {
  const { outputs } = buildAll();
  const diffs = [];
  for (const [rel, want] of outputs) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) diffs.push(`${rel}: missing (run node scripts/build-archive.mjs)`);
    else if (readFileSync(abs, "utf8") !== want) diffs.push(`${rel}: differs from the generator (run node scripts/build-archive.mjs)`);
  }
  return diffs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const diffs = checkAll();
    if (diffs.length) {
      console.error(diffs.join("\n"));
      process.exit(1);
    }
    console.log("archive: committed output matches the generator");
  } else {
    const { entries, outputs } = buildAll();
    for (const [rel, content] of outputs) writeFileSync(path.join(root, rel), content);
    const lost = entries.filter((e) => e.status === "lost").length;
    console.log(`archive: ${entries.length} pages (${entries.length - lost - 2} articles, ${lost} lost, 2 video records) + index.json + archive.html inventory`);
  }
}
