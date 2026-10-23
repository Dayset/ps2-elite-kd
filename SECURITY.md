# Security

## Supported versions

Only what runs now: the `main` branch, the live site (https://dayset.github.io/ps2-elite-kd) and the two Cloudflare Workers deployed from it (`ps2-elite-kd-cache`, `ps2-oracle`). There are no releases or older versions to patch.

## Reporting a vulnerability

Please report privately through GitHub: **[Report a vulnerability](https://github.com/Dayset/ps2-elite-kd/security/advisories/new)** (Security tab → "Report a vulnerability"). Don't open a public issue for security problems. If that button is missing, open an issue that only says "security report, need a private channel" (no details) and you'll get one.

Helpful to include: what is affected (page, Worker endpoint, workflow), steps to reproduce, and what an attacker could do.

What to expect (hobby project, best effort):

| Step | Time |
|---|---|
| First answer | within 7 days |
| Fix or plan for a confirmed issue | within 30 days |
| Public advisory and credit (if you want it) | after the fix |

In scope: the site's code, the Workers (`worker/`, `oracle-worker/`), the GitHub Actions workflows, the oracle sign-in and voting. Out of scope: Daybreak's Census API, Honu, PS2Alerts, PS2 Radar, GitHub and Cloudflare themselves (report to them), and rate limits being reachable.

Please don't run automated scans or load tests against the Workers or Census through our service ID, and don't access other people's oracle accounts beyond what you need to show the problem.

## How the project protects data

- Secrets (GitHub token, Census proxy key, Cloudflare token) live only in GitHub and Cloudflare settings, never in the repository. Secret scanning and push protection are on.
- Visitor IP addresses are stored only as keyed hashes, for short rate limits (`PRIVACY.md`).
- Oracle tokens are HMAC-signed with a random server secret; one active token per character; signing out revokes it.
- The site loads no third-party scripts, so no outside code runs on visitors' pages (a test checks this).
- Workers deploy only from `main` through GitHub Actions.

## If personal data leaks

The only non-public personal data is the oracle's sign-in data (character, token, votes, keyed IP hashes). Player stats are public game data already.

1. **Contain:** revoke the leaked secret or token (rotate `ORACLE_KEY` / `CENSUS_PROXY_KEY` / the D1 `auth_secret`, which signs everyone out), fix the hole, redeploy.
2. **Assess** within 72 hours: what leaked, whose, since when, likely harm.
3. **Tell people:** a pinned GitHub issue and a note on the oracle page. If EU or UK players are likely harmed, report to a data protection authority within 72 hours of finding out (GDPR Art. 33).
4. **Record** what happened and what changed in the issue, and close it when done.
