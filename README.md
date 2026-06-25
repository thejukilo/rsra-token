# RSRA Token

A small, friendly front-end for `rsra.roche.com/Token/Generate`. You pick **one
thing** — the token type — and it renders the resulting token as a **Code 128
barcode** you can scan straight off the screen (e.g. into an x800 system).

Run it locally with one command — no hosting, no build step.

| File | What it is |
| --- | --- |
| `serve.py` | Local host + reverse proxy (Python stdlib). **This is what you run.** |
| `index.html` | The UI (one dropdown → barcode). |
| `app.js` | Talks to RSRA (via the proxy) and drives the UI. |
| `code128.js` | Zero-dependency Code 128 encoder → SVG. |

## Run it

```bash
python serve.py
```

It serves the app at <http://localhost:8765>, opens your browser, and
reverse-proxies `/Token/*` to RSRA. Pick a token type → barcode.

### Why a proxy (and not just open the .html)?

A page opened from disk can't read RSRA's responses (**CORS**) and can't send
your session cookie (**SameSite**) — those are browser-only rules. `serve.py`
sidesteps both: the browser only talks to `localhost`, and the script makes the
real call to RSRA **server-side**, where neither rule applies.

### Cookies (so the proxy is authenticated)

`serve.py` needs your logged-in `rsra.roche.com` session. In order of preference:

1. **Auto (recommended):** `pip install browser_cookie3`, make sure you're
   logged in to RSRA in your browser, then run `serve.py`. It reads the
   roche.com cookies for you. Pick the browser with
   `RSRA_BROWSER=chrome|edge|firefox` if needed.
   *(Note: latest Chrome on Windows encrypts its cookie store; if auto fails,
   use Edge/Firefox or the paste method below.)*
2. **Paste once:** copy the `cookie` header from DevTools → Network → any RSRA
   request, then either
   - `RSRA_COOKIE="PF=...; .AspNetCore.cookieC1=...; ..."`, or
   - save it to `rsra_cookie.txt` next to `serve.py`.

Env knobs: `RSRA_PORT` (default 8765), `RSRA_BASE` (default
`https://rsra.roche.com`), `RSRA_INSECURE=1` (skip TLS verify — last resort).

## Try it with no Roche at all

Open <http://localhost:8765/?demo> (or `index.html?demo`). Demo mode shows a
sample token + barcode so you can sanity-check the UI and that it scans.

## Finalizing token extraction

`extractToken()` in `app.js` uses robust heuristics but hasn't been matched
against a **real** `/Token/Generate` response yet. To lock it in:

1. Open the app with `?debug`.
2. Generate a token.
3. Copy the `[rsra-token] /Token/Generate response:` HTML logged to the console
   (redact the token value) and share it — extraction becomes a one-line selector.

## Configuration (`app.js`)

- `CONFIG.useCases` — the dropdown options. Only `Authentication` is known so
  far; add the others once confirmed.
- `CONFIG.defaultExpiryDays` — fallback validity if the form doesn't supply one.
- `CONFIG.base` — leave `""` (same-origin); the proxy handles the rest.

## Open questions

- **Barcode symbology:** Code 128 (confirmed).
- **Other token types:** only `Authentication` is wired up; send the full list.
- **`/Token/Generate` response shape** — needed to finalize extraction (see above).
