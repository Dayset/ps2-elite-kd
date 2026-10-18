#!/usr/bin/env python3
"""
Tiny HTTP API for PS2Oracle in-game auth.
Exposes auth_challenge.py functions to the artifact frontend.

Endpoints:
  POST /auth/start    {"name": "Fantom220TR"} -> {challenge_id, display_name, expires_in}
  GET  /auth/check?id=<challenge_id> -> {status, suicides_seen, logout_seen, time_remaining}
  POST /auth/complete {"challenge_id": "..."} -> {token, display_name} or {error}
  POST /auth/verify   {"token": "..."} -> {character_id, display_name} or {error}

Run: python3 auth_api.py  (listens on 127.0.0.1:8901)
"""
import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auth_challenge

PORT = 8901


class AuthHandler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length:
            return json.loads(self.rfile.read(length) or b"{}")
        return {}

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/auth/start":
                body = self._read_body()
                name = (body.get("name") or "").strip()
                if not name:
                    return self._send(400, {"error": "Name required"})
                cid, display = auth_challenge.resolve_character(name)
                if not cid:
                    err = getattr(auth_challenge.resolve_character, "last_error", None)
                    body = {"error": f"Character '{name}' not found on Census"}
                    if err:
                        body["detail"] = f"Census lookup failed: {err}"
                    return self._send(404, body)
                ch = auth_challenge.issue_challenge(cid, display)
                return self._send(200, {
                    "challenge_id": ch["id"],
                    "display_name": display,
                    "character_id": cid,
                    "expires_in": auth_challenge.CHALLENGE_WINDOW_SEC,
                    "required_suicides": auth_challenge.REQUIRED_SUICIDES,
                })
            elif path == "/auth/complete":
                body = self._read_body()
                cid = body.get("challenge_id", "")
                token, name = auth_challenge.complete_challenge(cid)
                if not token:
                    return self._send(400, {"error": "Challenge not verified yet"})
                return self._send(200, {"token": token, "display_name": name})
            elif path == "/auth/verify":
                body = self._read_body()
                cid, name = auth_challenge.verify_token(body.get("token", ""))
                if not cid:
                    return self._send(401, {"error": "Invalid or expired token"})
                return self._send(200, {"character_id": cid, "display_name": name})
            else:
                return self._send(404, {"error": "Not found"})
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/auth/check":
            qs = parse_qs(parsed.query)
            cid = (qs.get("id") or [""])[0]
            result = auth_challenge.check_challenge(cid)
            return self._send(200, result)
        elif parsed.path == "/auth/health":
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "Not found"})

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    srv = HTTPServer(("127.0.0.1", PORT), AuthHandler)
    print(f"Auth API listening on 127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
