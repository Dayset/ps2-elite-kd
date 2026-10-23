# Privacy

How PS2 Elite (https://dayset.github.io/ps2-elite-kd) and the PS2Map Oracle handle personal data. The short version for visitors is the site's [privacy page](https://dayset.github.io/ps2-elite-kd/privacy.html); this file is the full one. Last updated 2026-10-23 (issue #61).

**Who runs it:** Dayset, a hobby project, free, no company, no ads, no money involved. Contact: [GitHub issues](https://github.com/Dayset/ps2-elite-kd/issues) (public). Security reports: [private report form](https://github.com/Dayset/ps2-elite-kd/security/advisories/new).

## 1. Players (people whose characters appear on the site)

**What:** public PlanetSide 2 game data from the Daybreak Census API, plus Honu for details Census lacks: character name and id, outfit tag, faction and server, account creation and last login time, kills, deaths, play time, accuracy, headshots, weapon stats, the top 200 opponents by name, and session details (assists, kill lists for a few sessions). On the PlayStation servers a live collector also records login/logout times and assists from Daybreak's event stream. The oracle keeps per-alert lists of statistical outliers (name, kills, deaths, K/D, KPM) and a PS2 Radar second opinion for flagged players.

**Not collected:** real names, emails, accounts, payment data, location, chat, or anything else that is not in the public game APIs. We don't know who plays a character.

**Why (purpose):** player statistics and rankings for the PlanetSide 2 community, fair comparisons between players, alert predictions, and spotting statistical outliers (possible cheating or stat padding) so they don't distort the rankings.

**Lawful basis (GDPR Art. 6(1)(f), legitimate interests):** the data is published by Daybreak on purpose for community sites like this one, it is tied to an in-game pseudonym, and the use matches what players expect from a stats site. You can object at any time (section 4).

**Profiling and marks:** ratings, percentiles and marks (\*, †, 💩, 🚩, hidden from Rankings) are automated estimates or owner reviews of public stats. They are not facts, proof or accusations. They have no legal or similar effect on anyone; they only change how a hobby leaderboard sorts. If you think a mark on your character is wrong, open an issue and it gets a human review.

**Where it is shown:** the public site and the public GitHub repository (`data/`, `data-ps/`). The oracle's outlier lists are on the oracle page.

**How long:**

| Data | Kept |
|---|---|
| Cached player files (`data/players/`, `data-ps/players/`) | Refreshed while the character exists; deleted on a removal request |
| PlayStation login/logout and assist sessions (cache Worker) | 45 days, then deleted automatically |
| PC kill-monitor pilot (10 characters, cache Worker, from 2026-10-17) | Kept for the pilot analysis; deleted on request |
| Oracle outlier reports (per alert) | Kept for fair-play research; deleted on request |
| Oracle map snapshots / population / flips and ticks | 30 days / 30 days / 90 days |
| Older copies in the repository's Git history and in GitHub Actions logs | Git history stays (rewriting it is possible on request but disruptive); logs up to 90 days |

## 2. Visitors of the site

- **No cookies, no analytics, no ads, no trackers, no third-party scripts or fonts.** No consent banner is needed because nothing non-essential is stored or read on your device.
- **Your browser's storage** (localStorage) keeps only things you asked for: theme, language, sound and display switches, the names you compared, and a copy of player stats so they load fast (about 30 days). It never leaves your device. "Clear local data" in the footer deletes it all.
- **Your browser talks to Daybreak directly** for live stats (Census API), so Daybreak sees your IP address under its own privacy policy. Links to Honu, PS2 Radar and GitHub go to those sites under their own policies.
- **Hosting:** GitHub Pages serves the site and logs visitors' IP addresses for security (GitHub's privacy statement applies).
- **Cache Worker** (Cloudflare, `ps2-elite-kd-cache`): when you ask for a name to be cached or fetched, it receives the names and your IP address. The IP is used only for a rate limit and stored as a keyed hash (never the address itself) for about an hour. It keeps how often each cached player was looked up (no IP) and the list of requested names (45 days). The oracle Worker has Cloudflare's Workers logs switched on (request details, kept 3 days).

## 3. Oracle sign-in and voting

- Sign-in proves you play a character by asking you to log out of the game within a short window. We store the character's id, name, server and faction, a sign-in token (kept in your browser as `ps2oracle_token`), your BonusCheque balance and your votes. BonusCheques are a joke currency: no cash value, never bought, sold, traded or paid out.
- Each sign-in attempt stores the character and a keyed hash of your IP address for a 10-minute rate limit. Attempts are deleted after 1 day.
- Account, balance and votes are kept while the account exists. Signing out revokes the token. To delete the account, balance and votes, open an issue (or use the removal form below) and they are deleted.

## 4. Your choices and rights

- **Remove your character:** use the [removal form](https://github.com/Dayset/ps2-elite-kd/issues/new?template=remove-character.yml). The cached stats are deleted, the bots stop fetching the character, it leaves Rankings and is blanked in other players' opponent lists, and the site shows "removed at the player's request" instead of stats. The character's id and name stay on the removal list so it stays removed. We remove a character only after you prove it is yours, so nobody can remove someone else (PC: sign in once on the oracle page; PlayStation: log out at a time we give you, checked on Census). Requests without proof are closed. The stats themselves remain on Daybreak's servers and other sites; we can only remove our copy.
- **Other rights** (access, correction, objection, deletion, restriction, portability where it applies): open an issue. We answer within one month.
- **Complaints:** you can complain to your data protection authority.

## 5. Service providers

GitHub (site hosting, repository, Actions) and Cloudflare (Workers, D1 database, KV) process data for the site under their standard terms, including their data protection terms. Both are based in the US and transfer data under their own safeguards (EU–US Data Privacy Framework / standard contractual clauses). No other processors; nothing is sold or shared.

## 6. Self-hosting

The code is MIT licensed. If you run your own copy, you are the one responsible for its data and for complying with the law where you run it; your copy needs its own privacy notice.

## 7. Changes

Changes to this notice are in the repository history of `PRIVACY.md` and `privacy.html`.
