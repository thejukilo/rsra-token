# RSRA Token

A small, friendly front-end for `rsra.roche.com/Token/Generate`. You pick **one
thing** — the token type — and it renders the resulting token as a **Code 128
barcode** you can scan straight off the screen (e.g. into an x800 system).

It is a **completely self-contained static app**: plain HTML + JS, no build
step, no framework, no backend. Three files:

| File | What it is |
| --- | --- |
| `index.html` | The whole UI (one dropdown → barcode). |
| `app.js` | Talks to RSRA and drives the UI. |
| `code128.js` | Zero-dependency Code 128 encoder → SVG. |

## How it works

Because RSRA is behind Roche SSO and protected by an anti-forgery token, the
only way to generate a token automatically is to run **in an authenticated RSRA
context**. So this app, served from the same origin, does exactly what the real
form does:

1. `GET /Token/Create?UseCase=<type>` — scrapes the live
   `__RequestVerificationToken` **and** the form's default fields (UserId,
   ExpirationDate, Systems, disclaimer flags).
2. `POST /Token/Generate` — submits precisely what the browser would, with your
   chosen `UseCase`.
3. Parses the token out of the response HTML and renders the barcode.

Your SSO session and the anti-forgery cookie are attached automatically by the
browser (`credentials: include`) — **nothing sensitive is stored or sent
anywhere except RSRA itself.**

## Deployment

This must be served **same-origin as RSRA** so the browser shares the session
cookie. Options, cleanest first:

- **Host it under a `roche.com` origin** (ideal) — e.g. RSRA serves
  `/token-ui/` as static files. Then `CONFIG.base = ""` just works.
- **A same-origin reverse proxy** that maps a path to `rsra.roche.com`.

A standalone host on a *different* origin (Vercel, etc.) will be blocked by
CORS + cookie scoping — that's a property of the auth model, not this app.

## Try it now (no Roche needed)

Open `index.html` with `?demo`:

```
index.html?demo
```

Demo mode skips RSRA and shows a sample token + barcode, so you can sanity-check
the UI and that the barcode scans.

## Finalizing token extraction

`extractToken()` in `app.js` uses robust heuristics, but it hasn't yet been
matched against a **real** `/Token/Generate` response (we don't have that HTML).
To lock it in:

1. Open the app with `?debug`.
2. Generate a token.
3. Copy the `[rsra-token] /Token/Generate response:` HTML logged to the console
   (redact the token value) and share it — the extractor becomes a one-line,
   exact selector.

## Configuration (`app.js`)

- `CONFIG.useCases` — the dropdown options. Only `Authentication` is known so
  far; add the others once confirmed.
- `CONFIG.defaultExpiryDays` — fallback validity if the form doesn't supply one.
- `CONFIG.base` — RSRA origin; `""` (same-origin) is the intended setting.

## Notes / open questions

- **Barcode symbology:** Code 128 (confirmed).
- **Other token types:** only `Authentication` is wired up; send the full list.
- **UserId:** taken from the Create form's default (the logged-in user). If RSRA
  doesn't pre-fill it, we'll add a remembered field.
