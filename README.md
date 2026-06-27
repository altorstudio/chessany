# Chessany

Play and analyze chess against **Stockfish**, on device. One TypeScript
codebase ships to **web, iOS, and Android** via [Capacitor](https://capacitorjs.com/).

A sidebar organizes the app into six sections:

- **Analysis Board** — free board with live multi-line engine analysis.
- **Play Chess** — play Stockfish at adjustable difficulty, with a live Coach; save games.
- **Analyze Game** — import a PGN, step through it move-by-move with live eval and a full report.
- **Board Editor** — set up any position (piece palette + FEN), hand it to Play/Analysis.
- **Games Archive** — locally-saved games; reopen any in Analyze Game.
- **Openings** — browse a named-opening book and load lines onto the board.
- **Engine**: **Stockfish 18** — world-class, runs as WASM on the web and as a native
  multi-threaded binary on iOS/Android.

## Stack

| Concern | Choice |
|---|---|
| UI | React + Vite + TypeScript |
| Board | [chessground](https://github.com/lichess-org/chessground) (lichess's board) |
| Rules / legality / PGN | [chess.js](https://github.com/jhlywa/chess.js) |
| Engines | UCI-over-Web-Worker; engines compiled to WASM/JS |
| State | [zustand](https://github.com/pmndrs/zustand) |
| Native shells | Capacitor (iOS + Android) |

## Getting started

```bash
npm install          # also downloads engine binaries (postinstall)
npm run dev          # http://localhost:5173
npm run build        # production build → dist/
```

Engine binaries live in `public/engines/` and are **not** committed (they're
generated). `npm install` fetches Stockfish; re-fetch any time with:

```bash
npm run engines:fetch
```

## Project layout

```
src/
├── engines/
│   ├── Engine.ts            # the one interface every engine implements
│   ├── UciWorkerEngine.ts   # drives any UCI-speaking Web Worker
│   ├── uci.ts               # UCI `info` / `bestmove` parsing
│   └── registry.ts          # list of available engines (powers the picker)
├── game/chess.ts            # chess.js helpers (status, legal dests, UCI↔move)
├── store.ts                 # game + engine state (zustand)
├── components/
│   ├── Board.tsx            # chessground board
│   ├── EnginePicker.tsx     # choose the active engine
│   ├── PlayPanel.tsx        # play vs engine + difficulty
│   ├── AnalysisPanel.tsx    # eval bar + best lines
│   └── MoveList.tsx
└── App.tsx
public/engines/              # engine binaries (generated, gitignored)
scripts/fetch-engines.mjs    # downloads Stockfish
```

## Adding an engine

Both play and analysis talk only to the `Engine` interface, so adding one is local:

1. Get the engine as a **UCI-speaking Web Worker** (most chess engines compile
   to WASM via Emscripten, or are already JS). Add it to `scripts/fetch-engines.mjs`.
2. Register it in `src/engines/registry.ts` with a name, description, and worker URL.

That's it — it appears in the picker for both play and analysis. Note: engines
that block their worker during search (no `SharedArrayBuffer` threads) should set
`interruptible: false` so live analysis caps their per-move search time.

## Native apps (Capacitor)

```bash
npm run build
npx cap add ios        # one-time
npx cap add android    # one-time
npm run cap:sync       # after each web build
npx cap open ios       # or: npx cap open android
```

The engines use **single-threaded** WASM, so they need no `SharedArrayBuffer`
and run inside the native WebView without special headers.

## License

Stockfish is GPLv3. Application code is proprietary to Altor Studio.
Engine binaries are fetched at install time and not redistributed in this repo.
