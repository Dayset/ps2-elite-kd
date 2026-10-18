#!/usr/bin/env python3
"""
In-game authentication for PS2Oracle bettors.

Flow:
1. User enters character name -> we resolve to Census character ID
2. Challenge issued: "suicide 1x then logout within 60 seconds of GO"
3. We watch the Census event stream for:
   - 1x Death event where attacker_character_id == character_id (suicide)
   - 1x PlayerLogout event for that character_id
   - All within 60s of the challenge GO timestamp
4. Sequence verified -> account created, token issued
5. Token stored in browser localStorage for subsequent logins
6. Lost token / new device -> re-do the challenge (recovery)

Security properties:
- No account exists until the in-game actions are verified (no squatting)
- Census events are server-authoritative (can't be faked)
- Suicide requires character owner input (can't be forced by another player)
- Timestamp window prevents replay of old events

2026-10-12: Built per Dayset's spec. 1-min window, 1 suicide + logout.
"""

import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.request
import urllib.parse

DATA_DIR = os.path.expanduser("~/workspace/ps2polymarket/data/auth")
CHALLENGES_FILE = os.path.join(DATA_DIR, "challenges.json")
ACCOUNTS_FILE = os.path.join(DATA_DIR, "accounts.json")

# Challenge parameters (Dayset's spec 2026-10-12, refined 17:31)
# Flow: enter name -> instructions popup -> ACCEPT button has 10s cooldown
# (anti-squatter: prevents catching someone's rage-quit suicides)
# -> click ACCEPT -> 60s window starts immediately -> 1 suicide + logout = verified
ACCEPT_COOLDOWN_SEC = 10  # ACCEPT button disabled for 10s after popup opens
CHALLENGE_WINDOW_SEC = 60  # 1 minute window after ACCEPT is clicked
REQUIRED_SUICIDES = 1  # just one suicide + logout

# Token: HMAC-signed, contains character ID. No expiry — stored "for an eternity"
# on the user's browser/PC. Lost token = re-do the in-game challenge.
# 2026-10-12: Dayset — no token expiry, permanent until cleared or replaced.
TOKEN_SECRET_FILE = os.path.join(DATA_DIR, ".token_secret")


def _ensure_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _save_json(path, data):
    _ensure_dir()
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.rename(tmp, path)


def _get_token_secret():
    """Persistent secret for signing tokens. Generated once, never exposed."""
    _ensure_dir()
    if os.path.exists(TOKEN_SECRET_FILE):
        with open(TOKEN_SECRET_FILE, "rb") as f:
            return f.read()
    secret = secrets.token_bytes(32)
    with open(TOKEN_SECRET_FILE, "wb") as f:
        f.write(secret)
    os.chmod(TOKEN_SECRET_FILE, 0o600)
    return secret


def resolve_character(name):
    """
    Resolve a character name to Census character ID.
    Returns (character_id, display_name) or (None, None) if not found.
    On network/lookup failure, the error is stored on
    resolve_character.last_error for clearer diagnostics.
    """
    resolve_character.last_error = None
    # Use Census API to resolve name -> character ID
    # Service ID from environment or default
    service_id = os.environ.get("CENSUS_SERVICE_ID", "example")
    query = urllib.parse.quote(name.strip())
    url = (
        f"https://census.daybreakgames.com/s:{service_id}/get/ps2:v2/"
        f"character/?name.first_lower={query.lower()}&c:resolve=outfit"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PS2Oracle-Auth/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.load(resp)
        chars = data.get("character_list", [])
        if not chars:
            return None, None
        c = chars[0]
        return c.get("character_id"), c.get("name", {}).get("first", name)
    except Exception as e:
        # Distinguish "character doesn't exist" (empty list above) from
        # "the lookup itself failed" (network, Census down, egress blocked)
        resolve_character.last_error = str(e) or type(e).__name__
        return None, None


def issue_challenge(character_id, display_name):
    """
    Issue a new auth challenge for a character.
    Returns challenge dict. The challenge has two phases:
    1. READY phase (10s): user reads instructions, switches to game
    2. GO phase (60s): system watches for 1 suicide + logout
    
    Only one active challenge per character at a time.
    """
    challenges = _load_json(CHALLENGES_FILE, {})
    now = time.time()

    # Clean expired challenges
    challenges = {
        k: v for k, v in challenges.items()
        if now - v.get("expires_ts", 0) < 30
    }

    challenge_id = secrets.token_hex(16)
    # Note: go_ts is set when ACCEPT is clicked (via accept_challenge),
    # not at issuance. This gives the user time to read instructions.
    challenge = {
        "id": challenge_id,
        "character_id": str(character_id),
        "display_name": display_name,
        "issued_ts": now,
        "accepted_ts": None,  # set on ACCEPT
        "go_ts": None,  # accepted_ts + READY_DELAY_SEC
        "expires_ts": None,  # go_ts + CHALLENGE_WINDOW_SEC
        "suicides_seen": 0,
        "suicide_timestamps": [],
        "logout_seen": False,
        "status": "issued",  # issued -> ready -> pending -> verified | expired
    }
    challenges[challenge_id] = challenge
    _save_json(CHALLENGES_FILE, challenges)
    return challenge


def accept_challenge(challenge_id):
    """
    User clicked ACCEPT. 60s window starts immediately.
    Enforces 10s cooldown server-side: ACCEPT rejected if clicked
    within ACCEPT_COOLDOWN_SEC of issuance (anti-squatter).
    Returns (go_timestamp, expires_timestamp) or (None, None).
    """
    challenges = _load_json(CHALLENGES_FILE, {})
    ch = challenges.get(challenge_id)
    if not ch or ch["status"] != "issued":
        return None, None
    now = time.time()
    # Anti-squatter: must wait 10s after issuance before ACCEPT works.
    # Prevents catching someone's rage-quit suicide+logout sequence.
    if now - ch["issued_ts"] < ACCEPT_COOLDOWN_SEC:
        return None, None
    ch["accepted_ts"] = now
    ch["go_ts"] = now  # window starts immediately on ACCEPT
    ch["expires_ts"] = now + CHALLENGE_WINDOW_SEC
    ch["status"] = "pending"
    _save_json(CHALLENGES_FILE, challenges)
    return ch["go_ts"], ch["expires_ts"]


def get_challenge(challenge_id):
    challenges = _load_json(CHALLENGES_FILE, {})
    return challenges.get(challenge_id)


def record_suicide(character_id, event_ts):
    """
    Called by census_events.py when a suicide Death is detected.
    Only counts suicides during the 'pending' phase (after ACCEPT, before expiry).
    Events before ACCEPT are ignored (anti-squatter).
    """
    challenges = _load_json(CHALLENGES_FILE, {})
    now = time.time()
    updated = False

    for cid, ch in challenges.items():
        if ch["character_id"] != str(character_id):
            continue
        if ch["status"] != "pending":
            continue
        if now > ch["expires_ts"]:
            ch["status"] = "expired"
            updated = True
            continue
        # Only count suicides after ACCEPT (go_ts)
        if event_ts < ch["go_ts"]:
            continue
        ch["suicides_seen"] += 1
        ch["suicide_timestamps"].append(event_ts)
        updated = True
        if ch["suicides_seen"] >= REQUIRED_SUICIDES and ch["logout_seen"]:
            ch["status"] = "verified"
        break

    if updated:
        _save_json(CHALLENGES_FILE, challenges)
    return None


def record_logout(character_id, event_ts):
    """
    Called by census_events.py when a PlayerLogout is detected.
    Only counts during 'pending' phase. Logout must come after the suicide.
    Returns challenge_id if verified, else None.
    """
    challenges = _load_json(CHALLENGES_FILE, {})
    now = time.time()
    verified_id = None

    for cid, ch in challenges.items():
        if ch["character_id"] != str(character_id):
            continue
        if ch["status"] != "pending":
            continue
        if now > ch["expires_ts"]:
            ch["status"] = "expired"
            continue
        if event_ts < ch["go_ts"]:
            continue
        ch["logout_seen"] = True
        if ch["suicides_seen"] >= REQUIRED_SUICIDES:
            if ch["suicide_timestamps"] and event_ts >= max(ch["suicide_timestamps"]):
                ch["status"] = "verified"
                verified_id = cid
        break

    _save_json(CHALLENGES_FILE, challenges)
    return verified_id


def check_challenge(challenge_id):
    """
    Check the status of a challenge.
    Returns dict with status, phase timings, suicides_seen, logout_seen.
    Status: issued | ready | pending | verified | expired | completed | not_found
    """
    ch = get_challenge(challenge_id)
    if not ch:
        return {"status": "not_found"}
    now = time.time()

    # Transition issued -> still issued (waiting for ACCEPT cooldown)
    # Expire pending challenges
    if ch["status"] == "pending" and ch.get("expires_ts") and now > ch["expires_ts"]:
        ch["status"] = "expired"
        challenges = _load_json(CHALLENGES_FILE, {})
        challenges[challenge_id] = ch
        _save_json(CHALLENGES_FILE, challenges)
    # Expire issued challenges that were never accepted (5 min)
    if ch["status"] == "issued" and now - ch.get("issued_ts", now) > 300:
        ch["status"] = "expired"
        challenges = _load_json(CHALLENGES_FILE, {})
        challenges[challenge_id] = ch
        _save_json(CHALLENGES_FILE, challenges)

    result = {
        "status": ch["status"],
        "suicides_seen": ch["suicides_seen"],
        "suicides_required": REQUIRED_SUICIDES,
        "logout_seen": ch["logout_seen"],
        "display_name": ch["display_name"],
        "accept_cooldown": ACCEPT_COOLDOWN_SEC,
        "window": CHALLENGE_WINDOW_SEC,
    }
    if ch["status"] == "issued":
        # Time until ACCEPT becomes clickable
        elapsed = now - ch.get("issued_ts", now)
        result["accept_in"] = max(0, int(ACCEPT_COOLDOWN_SEC - elapsed))
    if ch["status"] == "pending" and ch.get("expires_ts"):
        result["time_remaining"] = max(0, int(ch["expires_ts"] - now))
    return result


def issue_token(character_id, display_name):
    """
    Create a signed auth token for a verified character.
    Token format: base64(character_id:signature)
    No expiry — valid until the user clears browser data or logs out.
    Lost token = re-do the in-game suicide challenge.
    """
    secret = _get_token_secret()
    payload = f"{character_id}"
    sig = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()[:32]
    token_raw = f"{payload}:{sig}"
    import base64
    token = base64.urlsafe_b64encode(token_raw.encode()).decode().rstrip("=")

    # Record the account
    accounts = _load_json(ACCOUNTS_FILE, {})
    accounts[str(character_id)] = {
        "display_name": display_name,
        "created_at": time.time(),
        "last_login": time.time(),
        "token_issued_at": time.time(),
    }
    _save_json(ACCOUNTS_FILE, accounts)
    return token


def verify_token(token):
    """
    Verify a token and return (character_id, display_name) or (None, None).
    Tokens never expire — only invalid if signature is wrong or account deleted.
    """
    import base64
    try:
        # Add padding back
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded).decode()
        parts = raw.split(":")
        if len(parts) != 2:
            return None, None
        character_id, sig = parts
        # Verify signature
        secret = _get_token_secret()
        payload = f"{character_id}"
        expected = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expected):
            return None, None
        # Check account exists
        accounts = _load_json(ACCOUNTS_FILE, {})
        acct = accounts.get(str(character_id))
        if not acct:
            return None, None
        # Update last login
        acct["last_login"] = time.time()
        _save_json(ACCOUNTS_FILE, accounts)
        return str(character_id), acct["display_name"]
    except Exception:
        return None, None


def complete_challenge(challenge_id):
    """
    Called when a challenge is verified. Creates the account and issues a token.
    Returns (token, display_name) or (None, None) if not verified.
    """
    ch = get_challenge(challenge_id)
    if not ch or ch["status"] != "verified":
        return None, None
    token = issue_token(ch["character_id"], ch["display_name"])
    # Mark challenge as consumed
    challenges = _load_json(CHALLENGES_FILE, {})
    if challenge_id in challenges:
        challenges[challenge_id]["status"] = "completed"
        _save_json(CHALLENGES_FILE, challenges)
    return token, ch["display_name"]


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: auth_challenge.py <test|issue|check|verify>")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "test":
        # Quick self-test (flow: issue -> wait cooldown -> accept -> 1 suicide + logout)
        _ensure_dir()
        print("Auth module self-test:")
        print(f"  Accept cooldown: {ACCEPT_COOLDOWN_SEC}s, window: {CHALLENGE_WINDOW_SEC}s")
        print(f"  Required suicides: {REQUIRED_SUICIDES}")
        # Test token round-trip
        tok = issue_token("12345", "TestPlayer")
        cid, name = verify_token(tok)
        assert cid == "12345" and name == "TestPlayer", "Token round-trip failed"
        print("  Token issue/verify: OK")
        # Test challenge flow
        ch = issue_challenge("12345", "TestPlayer")
        assert ch["status"] == "issued"
        print(f"  Challenge issued: {ch['id'][:8]}...")
        # ACCEPT too early should fail (anti-squatter)
        go, exp = accept_challenge(ch["id"])
        assert go is None, "ACCEPT should be rejected during cooldown"
        print("  ACCEPT during cooldown: correctly rejected")
        # Simulate cooldown passing
        challenges = _load_json(CHALLENGES_FILE, {})
        challenges[ch["id"]]["issued_ts"] = time.time() - ACCEPT_COOLDOWN_SEC - 1
        _save_json(CHALLENGES_FILE, challenges)
        go_ts, exp_ts = accept_challenge(ch["id"])
        assert go_ts and exp_ts, "ACCEPT failed after cooldown"
        print("  ACCEPT after cooldown: 60s window started")
        now = time.time()
        record_suicide("12345", now)
        vid = record_logout("12345", now + 1)
        assert vid == ch["id"], f"Verification failed: {vid}"
        print("  1 suicide + logout: VERIFIED")
        tok2, nm2 = complete_challenge(ch["id"])
        assert tok2 and nm2 == "TestPlayer"
        print("  Account + token: OK")
        print("All tests passed.")
