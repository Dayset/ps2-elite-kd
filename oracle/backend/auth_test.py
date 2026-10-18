#!/usr/bin/env python3
"""
CLI for testing the in-game auth flow.

Usage:
  python3 auth_test.py start <character_name>   - Start a challenge, get GO signal
  python3 auth_test.py check <challenge_id>      - Check challenge status
  python3 auth_test.py complete <challenge_id>   - Complete (get token if verified)

Flow for Dayset's PC test:
1. Run: python3 auth_test.py start Fantom220TR
2. Note the GO timestamp - you have 60 seconds
3. In-game: suicide 1x (type /suicide), then logout
4. Run: python3 auth_test.py check <challenge_id>  (repeat until verified)
5. Run: python3 auth_test.py complete <challenge_id>  (get your token)
"""
import sys
import os
sys.path.insert(0, os.path.expanduser("~/workspace/ps2polymarket"))

import auth_challenge
import time

def cmd_start(name):
    print(f"Resolving character: {name}...")
    cid, display = auth_challenge.resolve_character(name)
    if not cid:
        err = getattr(auth_challenge.resolve_character, "last_error", None)
        print(f"ERROR: Character '{name}' not found on Census.")
        if err:
            print(f"Lookup failed before Census could answer: {err}")
            print("This is a network/Census issue, not a spelling problem — try again.")
        else:
            print("Check the spelling and try again.")
        return
    print(f"Found: {display} (ID: {cid})")
    ch = auth_challenge.issue_challenge(cid, display)
    print()
    print("=" * 50)
    print("🟢 GO! You have 60 seconds.")
    print("=" * 50)
    print(f"Challenge ID: {ch['id']}")
    print(f"Character: {display}")
    print()
    print("In-game steps:")
    print("  1. Type /suicide (once)")
    print("  2. Logout (ESC -> Logout)")
    print()
    print(f"Check status with:")
    print(f"  python3 auth_test.py check {ch['id']}")
    print()

def cmd_check(challenge_id):
    result = auth_challenge.check_challenge(challenge_id)
    status = result.get("status", "unknown")
    print(f"Status: {status}")
    print(f"Suicides: {result.get('suicides_seen', 0)}/{result.get('suicides_required', 3)}")
    print(f"Logout: {'✅' if result.get('logout_seen') else '❌'}")
    print(f"Time remaining: {result.get('time_remaining', 0)}s")
    if status == "verified":
        print()
        print("✅ Challenge VERIFIED! Complete it with:")
        print(f"  python3 auth_test.py complete {challenge_id}")
    elif status == "expired":
        print()
        print("❌ Challenge expired. Start a new one.")

def cmd_complete(challenge_id):
    token, name = auth_challenge.complete_challenge(challenge_id)
    if not token:
        print("ERROR: Challenge not verified yet. Check status first.")
        return
    print()
    print("=" * 50)
    print(f"✅ Account created for {name}!")
    print("=" * 50)
    print()
    print("Your auth token (save this!):")
    print(f"  {token}")
    print()
    print("Store this in your browser's localStorage as 'ps2oracle_token'")
    print("for automatic login on future visits.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    arg = sys.argv[2]
    if cmd == "start":
        cmd_start(arg)
    elif cmd == "check":
        cmd_check(arg)
    elif cmd == "complete":
        cmd_complete(arg)
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
