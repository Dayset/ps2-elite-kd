# PS2MapOracle — Auth Challenge Design (current)

> **Renamed 2026-10-18:** betting is now **voting** (owner decision, #27). BonusCheques are a meme currency: no cash value, nothing is ever paid out, they can't be bought, sold, traded or cashed out. Current-state text below uses vote / amount / reward; dated history and code identifiers (`placebet`, the `bets` table, the `hex-betting-game` artifact) keep their original names. See `oracle/js/vote.js` (`DISCLAIMER`).

**Supersedes** the suicide+logout flow still present in `backend/auth_challenge.py`
and `backend/auth_test.py` (2026-10-12). Those files are kept for history; the
live design is logout-only.

---

## Goal

Prove the person registering a voting account owns the PlanetSide 2 character,
using only server-side Census data. No client software, no screenshots, no
fingerprinting.

## The challenge: logout-only

1. **Log into PlanetSide 2** (any character on the account).
2. **Enter character name** in the footer field, press **Register**.
   → Server validates the name via Census, creates a challenge UUID.
3. **Wait 5 seconds.** (Anti-squatter: prevents catching someone else's
   rage-quit logout.)
4. **Click ACCEPT** → the **60-second window** starts immediately.
5. **Log out via ESC** (in-game menu → Logout). **No suicide required.**
   → Server watches the Census `PlayerLogout` stream for that character ID
   inside the window.

Pass = one `PlayerLogout` event for the registered character ID within 60s of ACCEPT.
Fail = timeout, wrong character, or logout before ACCEPT (ignored as stale).

## Why logout-only (not suicide+logout)

- A suicide is character-owner input too, but it costs the player a death on
  their record and feels punitive for a login flow.
- Logout is equally unforgeable: only the account holder can trigger a
  `PlayerLogout` for their character, and the 5s wait + 60s window bind it to
  the challenge.
- Simpler UX: Register → wait → ACCEPT → ESC → done.

## Token policy

- On pass: server issues an **HMAC-signed token**, no expiry.
- Stored in the browser as `ps2oracle_token` (localStorage), indefinitely.
- **One active token per character.** A new verification revokes the old token.
- Lost token or new device/browser → re-do the challenge.
- **No PC fingerprinting** — unreliable and privacy-invasive.

## Anti-abuse notes

- Events before ACCEPT are ignored (fake/stale).
- The 5s wait before ACCEPT prevents double-click races and squatter claims.
- The 5s pre-ACCEPT wait defeats squatters who try to claim a stranger's
  natural logout.
- `auth_stream_health` reports whether the Census event stream is alive;
  challenges can't complete during a stream outage.

## Server actions involved

`start_auth_challenge` → `accept_auth_challenge` → `check_auth_challenge`
(poll) → `complete_auth` (issues token) → `verify_auth_token` (per request).
`logout_auth_token` revokes. `latest_auth_challenge` resumes.

## Open item

Proof still required: register → F5 → still authenticated in the Muse iframe
(the token must survive a page reload inside the artifact).
