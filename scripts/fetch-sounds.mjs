// Downloads the move/capture sound sets into public/sounds/<set>/.
//
// The samples are the Enigmahack sound sets from lichess's lila repository
// (public/sound/<set>), licensed AGPLv3+ — explicitly listed as such in lila's
// COPYING.md. (lichess's "standard" set is NOT used: it sits in lila's
// non-free exceptions.) Kept out of git and fetched on demand, like the
// engines and piece sets. Runs on `npm install` (postinstall) and via
// `npm run sounds:fetch`.

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const soundsDir = resolve(root, "public/sounds");

const BASE = "https://raw.githubusercontent.com/lichess-org/lila/master/public/sound";
const SETS = ["piano", "nes", "futuristic", "sfx"];
const FILES = ["Move", "Capture"];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let downloaded = 0;
let skipped = 0;
for (const set of SETS) {
  for (const name of FILES) {
    const dest = resolve(soundsDir, set, `${name}.mp3`);
    if (await exists(dest)) {
      skipped++;
      continue;
    }
    // Sets store mp3s; fall back to ogg just in case a set lacks one.
    let res = await fetch(`${BASE}/${set}/${name}.mp3`);
    if (!res.ok) res = await fetch(`${BASE}/${set}/${name}.ogg`);
    if (!res.ok) throw new Error(`${res.status} for ${set}/${name}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    downloaded++;
  }
  console.log(`✓ sounds: ${set}`);
}
console.log(`sounds: ${downloaded} downloaded, ${skipped} already present`);
