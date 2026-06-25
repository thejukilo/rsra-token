#!/usr/bin/env python3
"""
RSRA Token — local host + reverse proxy.

Run this and it will:
  1. Serve the app (index.html / app.js / code128.js) at http://localhost:8765
  2. Reverse-proxy /Token/* to https://rsra.roche.com, attaching your Roche
     session cookies — so the browser only ever talks to localhost (no CORS),
     while the real authenticated call happens here, server-side.
  3. Open your browser.

Why a proxy? A page opened from disk can't read RSRA's responses (CORS) and
can't send your session cookie (SameSite). Those are browser-only rules. A
server-to-server request has neither restriction, so this little proxy is all
it takes to make the local app fully automatic.

------------------------------------------------------------------------------
USAGE
    python serve.py

COOKIES — the proxy needs your logged-in rsra.roche.com session. In order:

  1. Auto (recommended): `pip install browser_cookie3`. The script reads the
     cookies for roche.com straight from your browser (you must already be
     logged in to RSRA in that browser). Choose the browser with
     RSRA_BROWSER=chrome|edge|firefox  (default: tries chrome, then edge, then firefox).

  2. Paste: set the whole Cookie header value once:
        RSRA_COOKIE="PF=...; .AspNetCore.cookieC1=...; ..."   (env var)
     or put it in a file named  rsra_cookie.txt  next to this script.
     (Copy it from DevTools → Network → any RSRA request → Request Headers → cookie.)

Other env vars:
    RSRA_PORT      local port (default 8765)
    RSRA_BASE      upstream base URL (default https://rsra.roche.com)
    RSRA_INSECURE  set to 1 to skip TLS verification (last resort, not recommended)
------------------------------------------------------------------------------
"""

import os
import ssl
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("RSRA_PORT", "8765"))
BASE = os.environ.get("RSRA_BASE", "https://rsra.roche.com").rstrip("/")
BASE_HOST = urlparse(BASE).netloc

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/code128.js": ("code128.js", "text/javascript; charset=utf-8"),
}

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)

# Shared cookie jar (name -> value), seeded once, updated from upstream Set-Cookie
# so the anti-forgery cookie minted on /Token/Create carries into /Token/Generate.
_cookies = {}
_cookie_lock = threading.Lock()

_ssl_ctx = ssl.create_default_context()
if os.environ.get("RSRA_INSECURE") == "1":
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE


# --------------------------------------------------------------------------- #
# Cookie sourcing
# --------------------------------------------------------------------------- #
def _parse_cookie_header(value):
    jar = {}
    for part in value.split(";"):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            jar[k.strip()] = v.strip()
    return jar


def load_initial_cookies():
    # 1. explicit env / file always wins
    raw = os.environ.get("RSRA_COOKIE")
    if not raw:
        path = os.path.join(HERE, "rsra_cookie.txt")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                raw = fh.read().strip()
    if raw:
        print("[cookies] using pasted cookie (env/rsra_cookie.txt)")
        return _parse_cookie_header(raw)

    # 2. auto-extract from the local browser
    try:
        import browser_cookie3  # type: ignore
    except ImportError:
        return {}

    order = [os.environ["RSRA_BROWSER"]] if os.environ.get("RSRA_BROWSER") else \
        ["chrome", "edge", "firefox"]
    for name in order:
        try:
            cj = getattr(browser_cookie3, name)(domain_name="roche.com")
            jar = {c.name: c.value for c in cj}
            if jar:
                print(f"[cookies] auto-loaded {len(jar)} cookie(s) from {name}")
                return jar
        except Exception as exc:  # locked DB, app-bound encryption, etc.
            print(f"[cookies] {name}: {exc}")
    return {}


def cookie_header():
    with _cookie_lock:
        return "; ".join(f"{k}={v}" for k, v in _cookies.items())


def update_cookies_from(resp):
    with _cookie_lock:
        for sc in resp.headers.get_all("Set-Cookie") or []:
            first = sc.split(";", 1)[0]
            if "=" in first:
                k, v = first.split("=", 1)
                _cookies[k.strip()] = v.strip()


# --------------------------------------------------------------------------- #
# HTTP handler
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = "RSRAProxy/1.0"

    def log_message(self, fmt, *args):  # quieter logs
        sys.stderr.write("  %s\n" % (fmt % args))

    # -- static files ------------------------------------------------------- #
    def _serve_static(self, route):
        filename, ctype = route
        try:
            with open(os.path.join(HERE, filename), "rb") as fh:
                body = fh.read()
        except FileNotFoundError:
            self.send_error(404, f"{filename} not found next to serve.py")
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- proxy -------------------------------------------------------------- #
    def _proxy(self, method):
        path = self.path  # includes query string
        url = BASE + path
        length = int(self.headers.get("Content-Length", 0) or 0)
        data = self.rfile.read(length) if length else None

        headers = {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            # Anti-forgery / referer checks expect the real origin, not localhost.
            "Origin": BASE,
            "Referer": BASE + "/Token/Create",
            "Cookie": cookie_header(),
        }
        if method == "POST":
            headers["Content-Type"] = self.headers.get(
                "Content-Type", "application/x-www-form-urlencoded"
            )

        if not headers["Cookie"]:
            self._json_error(401, "No Roche session cookies. See serve.py header "
                                  "for how to provide them (browser_cookie3 or paste).")
            return

        req = urlrequest.Request(url, data=data, method=method, headers=headers)
        try:
            resp = urlrequest.urlopen(req, context=_ssl_ctx, timeout=30)
            status = resp.status
        except HTTPError as exc:          # 4xx/5xx still carry a body
            resp, status = exc, exc.code
        except URLError as exc:
            self._json_error(502, f"Could not reach {BASE}: {exc.reason}")
            return

        update_cookies_from(resp)
        body = resp.read()

        # Detect a bounce to SSO / login → tell the app the session is dead.
        final = resp.geturl().lower()
        if any(s in final for s in ("login", "signin", "sso", "pingfederate", "/oauth")):
            self._json_error(401, "Not signed in to RSRA (redirected to login). "
                                  "Log in to rsra.roche.com in your browser, then retry.")
            return

        ctype = resp.headers.get("Content-Type", "text/html; charset=utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json_error(self, code, message):
        body = ('{"error": %s}' % _json_str(message)).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- routing ------------------------------------------------------------ #
    def do_GET(self):
        route = STATIC.get(self.path.split("?", 1)[0])
        if route:
            self._serve_static(route)
        elif self.path.startswith("/Token/"):
            self._proxy("GET")
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path.startswith("/Token/"):
            self._proxy("POST")
        else:
            self.send_error(404)


def _json_str(s):
    out = '"'
    for ch in s:
        if ch in '"\\':
            out += "\\" + ch
        elif ch == "\n":
            out += "\\n"
        else:
            out += ch
    return out + '"'


# --------------------------------------------------------------------------- #
def main():
    _cookies.update(load_initial_cookies())
    if not _cookies:
        print("\n[!] No cookies loaded yet. The app will load, but generating a")
        print("    token will fail until you provide a session — either:")
        print("      • pip install browser_cookie3   (auto, log in to RSRA first), or")
        print("      • set RSRA_COOKIE / create rsra_cookie.txt  (see serve.py header)\n")

    url = f"http://localhost:{PORT}/"
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"RSRA Token running at {url}")
    print(f"Proxying /Token/* → {BASE}   (Ctrl+C to stop)")
    try:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        server.shutdown()


if __name__ == "__main__":
    main()
