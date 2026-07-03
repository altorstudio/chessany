// Downloads the chess piece sets into public/pieces/<set>/<piece>.svg.
//
// The SVGs come from lichess's open-source lila repository (each set keeps its
// original author + license — cburnett CC BY-SA 3.0 (Colin M.L. Burnett),
// merida GPL (Armando Hernández Marroquín), alpha free-with-attribution (Eric
// Bentzen), maestro/staunty/fresca as licensed in lila). Kept out of git and
// fetched on demand, like the engines. Runs on `npm install` (postinstall) and
// via `npm run pieces:fetch`.
//
// To add a set: append its lila directory name to SETS, add the CSS rules in
// src/index.css, and list it in Settings + the PieceSet type (feedback.ts).

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piecesDir = resolve(root, "public/pieces");

const BASE = "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece";
// cburnett is also bundled via chessground's CSS for the board itself, but is
// fetched too so the Settings previews can show it from the same place.
const SETS = ["cburnett", "merida", "alpha", "maestro", "staunty", "fresca"];
const PIECES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

let downloaded = 0;
let skipped = 0;
for (const set of SETS) {
  for (const piece of PIECES) {
    const dest = resolve(piecesDir, set, `${piece}.svg`);
    if (await exists(dest)) {
      skipped++;
      continue;
    }
    await fetchFile(`${BASE}/${set}/${piece}.svg`, dest);
    downloaded++;
  }
  console.log(`✓ pieces: ${set}`);
}
console.log(`pieces: ${downloaded} downloaded, ${skipped} already present`);
