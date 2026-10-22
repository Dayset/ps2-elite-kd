# Translations (🌐 language menu)

One file per language, edited by people. The site reads the file for the language
the visitor picks (or the browser's language, if it is supported).

| File | Language | Menu order |
|---|---|---|
| `en.json` | English (reference, the source of every key) | 1 |
| `ja.json` | 日本語 | 2 |
| `ru.json` | Русский | 3 |
| `de.json` | Deutsch | 4 |
| `fr.json` | Français | 5 |
| `zh.json` | 中文 | 6 |
| `es.json` | Español | 7 |
| `uk.json` | Українська | 8 |

## How to translate a file

1. Open the language file (for example `ja.json`) and the reference `en.json` side by side.
2. Each line is `"key": "text"`. Never change or delete a key. Translate only the text after the colon.
3. Keep the emoji, the symbols (`…`, `→`, `≤`, `−`) and any `{name}` placeholder exactly as they are.
4. Don't leave a value empty. If you don't know a string yet, leave that line out: a missing line shows English, so the page never breaks.
5. Keep these words in English, as they are the names of stats on the site: **PS2 Elite, Daybreak, Honu, Census, iVi, Brave, Resist, Activity, Inflation, K/D, KPM, HSR, Mech, Const, Adjusted, Rankings**. You may add the local name in brackets the first time a word appears, if it helps.
6. Keep the text short. Buttons and labels must fit on a phone screen.
7. Check the JSON is valid (a missing comma or quote breaks the whole file, and the site then falls back to English). `npm test` checks this for you.

An empty file `{}` is valid: it simply shows English until someone fills it in.

## Japanese is the worked example

`ja.json` is complete (every key of `en.json`). Open it next to `en.json` and copy its approach:

- Same key names and order, one translation per line.
- Sentences built in code are split into one key with `{placeholders}`, so the word order can change for each language. Example: `pct.more` is `"{n}% {phrase} than the reference ({ref})"`, and the Japanese reads `"基準（{ref}）より {n}% {phrase}"`.
- Links stay in the page: the text around a link is its own key (`vehicles.p2`, `foot.licenseBefore`), and the link itself is written in `index.html`.
- Plurals are separate keys (`fights.kill` / `fights.kills`). Japanese uses one form for both.
- Stat names stay in English (see the list above). Column headings that are not stat names are translated (`col.assists`, `col.infantry`, `col.ownKpm`, `col.acc`).
- Hover texts (`tip.*`, `inf.*`, `veh.*`, `pad.*`, `apk.tip`, `dist.*`) are full sentences: translate the whole sentence, not word by word.

## Adding a new key

A new piece of text starts in English:

1. Add the key and English text to `en.json`.
2. In `index.html`, mark the element, for example `<button data-i18n="my.key">English text</button>`.
   Attributes work the same way: `data-i18n-title`, `data-i18n-aria-label`, `data-i18n-placeholder`.
   In `app.js`, use `tr("my.key", "English text")`.
3. Add the translation to each language file (or leave it out; English shows until it is filled in).

The tests (`test/i18n.test.mjs`) fail if a language file has a key that English does not have, if a
translation loses a `{placeholder}`, or if the page or a UI module uses a key that is not in `en.json`.
They never fail on a missing translation, since that is only a gap in coverage.

## Not translated (by design)

- Player legends (the long pilot stories about top players). They are hidden on the site.
- The language names in the menu (English, Deutsch, Français, Español): each is shown in its own language.
- Stat names listed above.
- Player names and clan tags.

## Still in English (gaps to fill)

- `columns.html`, `updates.html`, `build-log.html` and the oracle dashboard: not in the language menu yet.
- The live page's notes and feed heading (its button is translated).
