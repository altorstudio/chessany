// Downloads the chess engine binaries into public/engines/.
//
// These files are large and engine-specific, so they're kept out of git
// (see .gitignore) and fetched on demand. Runs automatically on `npm install`
// (postinstall) and via `npm run engines:fetch`.
//
// To add an engine: drop a new entry in ENGINES with its files, then register
// it in src/engines/registry.ts.

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const enginesDir = resolve(root, "public/engines");

const SF = "18.0.8"; // Stockfish.js release

const ENGINES = [
  {
    name: "Stockfish (lite, single-threaded — fallback without SharedArrayBuffer)",
    files: [
      {
        dest: "stockfish/stockfish.js",
        url: `https://unpkg.com/stockfish@${SF}/bin/stockfish-18-lite-single.js`,
      },
      {
        dest: "stockfish/stockfish.wasm",
        url: `https://unpkg.com/stockfish@${SF}/bin/stockfish-18-lite-single.wasm`,
      },
    ],
  },
  {
    // Multi-threaded WASM build (pthreads + SharedArrayBuffer + SIMD) — used on
    // the web where cross-origin isolation is enabled; many times faster than
    // the single-threaded build (like lichess). ORIGINAL filenames kept so the
    // .js locates its own .wasm and self-spawns its pthread workers.
    name: "Stockfish (lite, multi-threaded — web)",
    files: [
      {
        dest: "stockfish/stockfish-18-lite.js",
        url: `https://unpkg.com/stockfish@${SF}/bin/stockfish-18-lite.js`,
      },
      {
        dest: "stockfish/stockfish-18-lite.wasm",
        url: `https://unpkg.com/stockfish@${SF}/bin/stockfish-18-lite.wasm`,
      },
    ],
  },
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

let failures = 0;
for (const engine of ENGINES) {
  for (const file of engine.files) {
    const dest = resolve(enginesDir, file.dest);
    if (await exists(dest)) {
      console.log(`[engines] ✓ ${file.dest} (cached)`);
      continue;
    }
    try {
      const bytes = await download(file.url, dest);
      console.log(`[engines] ↓ ${file.dest} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failures++;
      console.warn(`[engines] ✗ ${file.dest}: ${err.message}`);
    }
  }
}

if (failures > 0) {
  // Don't fail the install — the app still runs with whatever engines fetched.
  console.warn(
    `[engines] ${failures} file(s) failed. Run \`npm run engines:fetch\` to retry.`,
  );
} else {
  console.log("[engines] all engines ready.");
}
