#!/usr/bin/env node
/**
 * RTL guard: bans physical-direction Tailwind utilities in apps/web.
 * Use logical properties instead: ml→ms, mr→me, pl→ps, pr→pe,
 * left-→start-, right-→end-, text-left→text-start, text-right→text-end,
 * rounded-l→rounded-s, rounded-r→rounded-e, border-l→border-s, border-r→border-e.
 * The Arabic UI depends on this — do not add exceptions without a review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../apps/web/src", import.meta.url).pathname;
const EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".css"]);
// physical-direction utilities (with optional variant/negative/breakpoint prefixes)
const BANNED =
  /(?<=[\s"'`:({[])-?(?:[a-z-]+:)*(?:ml|mr|pl|pr)-(?:\d|px|auto|\[)|(?<=[\s"'`:({[])(?:[a-z-]+:)*(?:text-left|text-right|left-\d|right-\d|rounded-[lr]\b|rounded-[lr]-|border-[lr]\b|border-[lr]-\d)/;

const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXTS.has(p.slice(p.lastIndexOf(".")))) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (BANNED.test(line)) {
          failures.push(`${relative(process.cwd(), p)}:${i + 1}  ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
}

try {
  walk(ROOT);
} catch {
  console.log("check-rtl: apps/web/src not found, skipping");
  process.exit(0);
}

if (failures.length) {
  console.error("✗ Physical-direction Tailwind classes found (breaks Arabic RTL).");
  console.error("  Use logical properties: ms-/me-/ps-/pe-/text-start/text-end/start-/end-\n");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("✓ check-rtl: no physical-direction classes");
