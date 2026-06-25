// ============================================================================
// RSRA Token — friendly front-end for rsra.roche.com/Token/Generate
//
// Flow:
//   1. GET  /Token/Create?UseCase=<x>   → scrape the live __RequestVerification-
//                                          Token AND the form's default fields.
//   2. POST /Token/Generate             → submit exactly what the real form would.
//   3. Parse the token out of the response HTML and render it as a Code 128 barcode.
//
// The /Token/* requests are same-origin. Run `python serve.py`: it serves this
// app on localhost and reverse-proxies /Token/* to RSRA with your session
// cookies, so there's no CORS/SameSite wall. (Deploying behind a roche.com
// origin works too.) See README.md for setup + the `?debug` / demo escapes.
// ============================================================================

import { renderBarcode } from "./code128.js";

const CONFIG = {
  // Base URL of the RSRA site. "" = same origin (the intended deployment).
  // Override via ?base=https://rsra.roche.com only if you have a CORS-enabled proxy.
  base: new URLSearchParams(location.search).get("base") ?? "",

  // The single user-facing setting: which token to generate.
  // Add entries here as RSRA exposes more use cases.
  useCases: ["Authentication"],

  // Default validity if the Create form doesn't supply one (days from today).
  defaultExpiryDays: 14,
};

const DEMO = new URLSearchParams(location.search).has("demo");
const DEBUG = new URLSearchParams(location.search).has("debug");

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const els = {
  useCase: document.getElementById("useCase"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  barcode: document.getElementById("barcode"),
  tokenText: document.getElementById("tokenText"),
  meta: document.getElementById("meta"),
  copyBtn: document.getElementById("copyBtn"),
  regenBtn: document.getElementById("regenBtn"),
};

function initUseCases() {
  els.useCase.innerHTML = "";
  for (const uc of CONFIG.useCases) {
    const opt = document.createElement("option");
    opt.value = uc;
    opt.textContent = uc;
    els.useCase.appendChild(opt);
  }
}

function setStatus(msg, kind = "info") {
  els.status.textContent = msg ?? "";
  els.status.dataset.kind = kind;
  els.status.hidden = !msg;
}

function showResult(show) {
  els.result.hidden = !show;
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/** Pick the <form> that posts to /Token/Generate (fallbacks for safety). */
function findGenerateForm(doc) {
  return (
    doc.querySelector('form[action*="Token/Generate" i]') ||
    [...doc.querySelectorAll("form")].find((f) =>
      f.querySelector('[name="__RequestVerificationToken"]'),
    ) ||
    doc.querySelector("form")
  );
}

/**
 * Serialize a form exactly as a browser would on submit: every successful
 * control, including ASP.NET's hidden `false` fallbacks for checkboxes (which
 * are plain hidden inputs and therefore always included). Checkboxes/radios are
 * only included when checked. Submit buttons are skipped.
 */
function serializeForm(form) {
  const params = new URLSearchParams();
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    const type = (el.type || "").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset" || type === "file") continue;
    if ((type === "checkbox" || type === "radio") && !el.checked) continue;
    if (el.tagName === "SELECT") {
      params.append(el.name, el.value);
    } else {
      params.append(el.name, el.value ?? "");
    }
  }
  return params;
}

/** Best-effort extraction of the generated token from the response HTML. */
function extractToken(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 1) An element explicitly marked as the token (id/name/data-* hint).
  const marked = doc.querySelector(
    '[id*="token" i], [name*="token" i], [data-token], [class*="token" i]',
  );
  const fromMarked = readValue(marked);
  if (fromMarked) return fromMarked;

  // 2) A readonly/disabled input or textarea (common for "copy this" fields).
  for (const el of doc.querySelectorAll("input[readonly], input[disabled], textarea")) {
    const v = readValue(el);
    if (v && looksLikeToken(v)) return v;
  }

  // 3) <code>/<pre> block holding a token-shaped string.
  for (const el of doc.querySelectorAll("code, pre, kbd, samp")) {
    const v = (el.textContent || "").trim();
    if (looksLikeToken(v)) return v;
  }

  return null;
}

function readValue(el) {
  if (!el) return null;
  const v = (el.value ?? el.getAttribute?.("data-token") ?? el.textContent ?? "").trim();
  return v || null;
}

/** Heuristic: a long, mostly-opaque token-ish string (tunable once we see a real one). */
function looksLikeToken(s) {
  return typeof s === "string" && s.length >= 16 && /^[\w\-.+/=]+$/.test(s);
}

function demoToken() {
  // Deterministic-ish sample so the UI + barcode are visible without Roche.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (let i = 0; i < 40; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

function defaultExpiryISO() {
  const d = new Date();
  d.setDate(d.getDate() + CONFIG.defaultExpiryDays);
  return d.toISOString().slice(0, 10);
}

async function generate(useCase) {
  if (DEMO) {
    return { token: demoToken(), useCase, expirationDate: defaultExpiryISO() };
  }

  // 1. Load the Create form for this use case.
  const createUrl = `${CONFIG.base}/Token/Create?UseCase=${encodeURIComponent(useCase)}`;
  const createRes = await fetch(createUrl, {
    credentials: "include",
    headers: { accept: "text/html" },
  });
  if (createRes.status === 401 || createRes.status === 403 || createRes.redirected) {
    throw new Error("Not signed in to RSRA. Open rsra.roche.com, log in, then retry.");
  }
  if (!createRes.ok) throw new Error(`Could not load the token form (HTTP ${createRes.status}).`);

  const createHtml = await createRes.text();
  const form = findGenerateForm(new DOMParser().parseFromString(createHtml, "text/html"));
  if (!form) throw new Error("Token form not found on the RSRA page (layout may have changed).");

  const body = serializeForm(form);
  body.set("UseCase", useCase); // the one thing the user chose
  if (!body.has("ExpirationDate")) body.set("ExpirationDate", defaultExpiryISO());

  // 2. Submit it.
  const genRes = await fetch(`${CONFIG.base}/Token/Generate`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    body: body.toString(),
  });
  if (!genRes.ok) throw new Error(`Token generation failed (HTTP ${genRes.status}).`);

  const genHtml = await genRes.text();
  if (DEBUG) {
    // Surface the raw response so the extraction rule can be finalized.
    console.log("[rsra-token] /Token/Generate response:\n", genHtml);
  }

  const token = extractToken(genHtml);
  if (!token) {
    throw new Error(
      "Token generated, but couldn't be located in the response. " +
        "Re-run with ?debug and share the logged HTML so extraction can be tuned.",
    );
  }
  return {
    token,
    useCase,
    expirationDate: body.get("ExpirationDate") || defaultExpiryISO(),
  };
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

let lastUseCase = null;

async function run() {
  const useCase = els.useCase.value;
  lastUseCase = useCase;
  localStorage.setItem("rsra.useCase", useCase);

  showResult(false);
  setStatus("Generating token…", "info");

  try {
    const { token, expirationDate } = await generate(useCase);

    els.barcode.replaceChildren(renderBarcode(token));
    els.tokenText.textContent = token;
    els.meta.textContent = `${useCase} · expires ${expirationDate}`;
    showResult(true);
    setStatus("");
  } catch (err) {
    showResult(false);
    setStatus(err instanceof Error ? err.message : String(err), "error");
  }
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(els.tokenText.textContent || "");
    const prev = els.copyBtn.textContent;
    els.copyBtn.textContent = "Copied ✓";
    setTimeout(() => (els.copyBtn.textContent = prev), 1500);
  } catch {
    setStatus("Couldn't copy — select the token text manually.", "error");
  }
}

function init() {
  initUseCases();
  const saved = localStorage.getItem("rsra.useCase");
  if (saved && CONFIG.useCases.includes(saved)) els.useCase.value = saved;

  if (DEMO) setStatus("Demo mode — showing a sample token (not from RSRA).", "info");

  els.useCase.addEventListener("change", run);
  els.regenBtn.addEventListener("click", run);
  els.copyBtn.addEventListener("click", copyToken);

  run(); // auto-generate on load → "one setting → barcode"
}

init();
