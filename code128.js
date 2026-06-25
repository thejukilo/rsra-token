// ============================================================================
// Code 128 (subset B) encoder → SVG
// Self-contained, zero dependencies. Encodes ASCII 32..126, which covers every
// character used by RSRA tokens (letters, digits, and base64url symbols).
// ============================================================================

// Canonical Code 128 module patterns, indexed by code value.
// Each string is the bar/space pattern: '1' = bar (black), '0' = space (white).
// 0..102 = data values, 103/104/105 = Start A/B/C, 106 = Stop.
const PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "1100011101011",
];

const START_B = 104;
const STOP = 106;

/**
 * Encode a string as Code 128 subset B.
 * @returns {string} a module string of '1' (bar) and '0' (space), no quiet zone.
 * @throws if the input contains a character outside ASCII 32..126.
 */
export function encodeCode128B(text) {
  const codes = [START_B];
  for (const ch of text) {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) {
      throw new Error(
        `Character "${ch}" (code ${ch.charCodeAt(0)}) cannot be encoded in Code 128 B`,
      );
    }
    codes.push(v);
  }
  // Modulo-103 checksum: start value (weight 1) + Σ position·value.
  let sum = START_B;
  for (let i = 1; i < codes.length; i++) sum += i * codes[i];
  codes.push(sum % 103);
  codes.push(STOP);
  return codes.map((c) => PATTERNS[c]).join("");
}

/**
 * Render a value as a Code 128 SVG element.
 * Always drawn as black bars on a white background (required for scanners),
 * regardless of page theme.
 *
 * @param {string} value
 * @param {{ moduleWidth?: number, height?: number, quietZone?: number }} [opts]
 * @returns {SVGSVGElement}
 */
export function renderBarcode(value, opts = {}) {
  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 140;
  const quietZone = opts.quietZone ?? 10; // modules of white on each side

  const modules = "0".repeat(quietZone) + encodeCode128B(value) + "0".repeat(quietZone);
  const totalWidth = modules.length * moduleWidth;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${totalWidth} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("width", "100%");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Barcode: ${value}`);
  svg.classList.add("barcode-svg");

  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(totalWidth));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", "#ffffff");
  svg.appendChild(bg);

  // Coalesce runs of bars into single rects.
  let x = 0;
  for (let i = 0; i < modules.length; ) {
    if (modules[i] === "1") {
      let run = 0;
      while (i < modules.length && modules[i] === "1") {
        run++;
        i++;
      }
      const bar = document.createElementNS(NS, "rect");
      bar.setAttribute("x", String(x * moduleWidth));
      bar.setAttribute("y", "0");
      bar.setAttribute("width", String(run * moduleWidth));
      bar.setAttribute("height", String(height));
      bar.setAttribute("fill", "#000000");
      svg.appendChild(bar);
      x += run;
    } else {
      x++;
      i++;
    }
  }

  return svg;
}
