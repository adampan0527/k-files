# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

k-files is a standalone CLI tool that watches a project directory for file changes and renders real-time K-line candlestick charts in the browser. Each file is a "stock ticker," each edit round is a candlestick (OHLC = line count open/high/low/close), and volume represents lines added or removed. It works editor-agnostic (Claude Code, Cursor, vim, manual edits).

## Build & Run Commands

```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript → dist/ (tsc)
npm run dev              # Watch mode (tsc --watch)
node dist/cli.js         # Run locally after build
npm run sync-vendor      # Copy market.js/market.css/lightweight-charts.js from ../KAgent/extension/media/
```

No test framework is configured. There are no unit tests.

## Architecture

```
Browser (localhost:13579)
  ├── cli-fallbacks.css     ← CSS variable defaults (--vscode-* for non-VS-Code context)
  ├── market.css            ← Vendor from KAgent (unchanged)
  ├── lightweight-charts.js ← TradingView charting library (vendor)
  ├── cli-bridge.js         ← Polyfill: acquireVsCodeApi() → WebSocket
  └── market.js             ← Vendor from KAgent (unchanged)
         ↕ WebSocket (JSON)
Server (Node.js)
  ├── cli.ts                ← Entry point: arg parsing, boots watcher + server
  ├── server.ts             ← HTTP server, 6 static routes, generates index.html inline
  ├── wsHub.ts              ← WebSocket connection pool, per-client state, broadcasts marketUpdate
  ├── payloadBuilder.ts     ← Orchestrates core modules to build FullPayload
  ├── watcher.ts            ← chokidar file watcher with per-file debouncing
  ├── record.ts             ← FileRecorder: wires watcher → snapshotManager → recordFileChange
  └── core/                 ← Domain logic (ported from KAgent, zero vscode deps)
       ├── types.ts          ← KfilesEvent, Candle, SymbolSummary, MarketPayload interfaces
       ├── candleBuilder.ts  ← events → OHLC candles (split delete+insert into 2 candles)
       ├── eventStore.ts     ← Reads events.ndjson and symbols.json
       ├── recordChange.ts   ← Appends events, updates symbols, coalesces duplicates
       ├── lineStats.ts      ← Line counting, content hashing, semantic churn detection
       ├── snapshotManager.ts← In-memory before-image cache for diff computation
       ├── symbolDelist.ts   ← Marks missing files as ST delisted, purges after 30s
       ├── fileLock.ts       ← Sync file lock (.kfiles/.lock) with stale detection
       ├── kfilesConfig.ts   ← Loads .kfiles/config.json, glob-to-regex for ignore patterns
       └── paths.ts          ← Path helpers for .kfiles/ directory
```

## Key Data Flow

1. **File change detected** by `watcher.ts` (chokidar) or Claude Code hook → `record.ts` (FileRecorder)
2. **FileRecorder** reads new content, compares with `snapshotManager` for before-image, calls `recordFileChange()` in `core/recordChange.ts`
3. **recordChange** computes OHLC stats, appends to `events.ndjson`, updates `symbols.json`, under file lock
4. **dataChanged** event triggers `wsHub.broadcastUpdate()` → `payloadBuilder.loadPayload()` → `candleBuilder.buildMarketPayload()` → JSON sent to all WebSocket clients
5. **Frontend** `market.js` receives `marketUpdate` message, renders candlestick chart via lightweight-charts library

## Frontend Architecture

- **vendor/** files (`market.js`, `market.css`, `lightweight-charts.js`) are copied from the sibling KAgent project and served unchanged
- **static/cli-bridge.js** is the adapter layer: polyfills `acquireVsCodeApi()` so `market.js` works outside VS Code, routing `postMessage` calls over WebSocket
- **static/cli-fallbacks.css** provides default values for 29 `--vscode-*` CSS variables (Dark+ theme)
- **server.ts** generates `index.html` inline (not from a file), loading assets in order: cli-fallbacks.css → market.css → lightweight-charts.js → cli-bridge.js → market.js

## WebSocket Protocol

Client → Server:
- `{ type: "ready" }` — request initial payload
- `{ type: "selectSymbol", file: "path/to/file" }` — select a file
- `{ type: "setColorScheme", scheme: "cn"|"us" }` — toggle CN/US color scheme
- `{ type: "setColorTone", tone: "dark"|"light" }` — toggle dark/light theme

Server → Client:
- `{ type: "marketUpdate", payload: FullPayload }` — full state including symbols, candles, selectedFile, colorScheme, colorTone

## Data Storage (.kfiles/)

- `events.ndjson` — append-only event log (one JSON line per edit event)
- `symbols.json` — file registry with metadata (ipo_ts, edit_count, last_lines, last_ts, content_hash, delisted status)
- `config.json` — ignore patterns and capture settings
- `.lock` — file-based mutex for concurrent write safety

## K-Line Mapping

| Stock Market | k-files |
|---|---|
| Stock ticker | A file in the project |
| IPO | First time a file is edited |
| Candlestick | One edit round (OHLC = line count open/high/low/close) |
| Volume | Lines added or removed |
| ST delisting | File deleted from workspace (30s grace period) |

When an edit has both deletions and additions, it splits into 2 candles: a "drop" candle (deletions) followed by a "rise" candle (additions).

## Important Conventions

- **Frontend files in vendor/ must not be modified** — they are synced from KAgent. If frontend changes are needed, modify them in the KAgent project and re-run `npm run sync-vendor`
- **cli-bridge.js and market.js communicate via the VS Code webview message protocol** (window MessageEvent). Any changes to the communication layer must preserve this contract
- The `metaByTime` Map in `market.js` is the bridge between candlestick time values and metadata (edit_index, volume, is_ipo, leg). Time values are synthetic: `BASE_TIME + edit_index * 3600 + sub_step * 900`
- All file paths in events/symbols are stored as forward-slash relative paths from workspaceRoot
- TypeScript compiles to CommonJS (not ESM), target ES2022
- The `hooks/` directory contains `.mjs` (ESM) scripts — they run directly with Node.js, not compiled by tsc
