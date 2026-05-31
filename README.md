# k-files

> Visualize file edits as stock-market-style K-line candlestick charts — in your browser, editor-agnostic.

k-files is a standalone CLI tool that watches your project directory for file changes (from any source — Claude Code, Codex CLI, Cursor, vim, manual edits) and renders real-time K-line candlestick charts showing what changed, when, and by how much.

## Quick Start

```bash
# Install globally
npm install -g k-files

# Navigate to your project
cd my-project

# Start watching and open the dashboard
k-files
```

This starts a local web server at `http://localhost:13579` and opens your browser. Every file change is reflected in the K-line chart within ~200ms.

## Features

- **Editor-agnostic** — works with Claude Code, Codex CLI, Cursor, vim, VS Code, or any tool that writes files
- **Real-time visualization** — WebSocket-powered live updates, no manual refresh needed
- **K-line candlestick charts** — each file is a "stock ticker", each edit round is a candle (OHLC = open/high/low/close line counts)
- **Semantic churn detection** — detects content changes even when line count stays the same
- **ST delisting** — deleted files are marked with a badge and gracefully removed after 30s
- **Claude Code hooks** — optional `PostToolUse` hooks for structured edit data with per-edit granularity
- **CN/US color schemes** — A-share style (red=up, green=down) or US style (green=up, red=down)

## Commands

### `k-files`

Start the file watcher and web server.

```
k-files [options]

Options:
  -p, --port <number>   Port for the web server (default: 13579)
  -d, --dir <path>      Workspace root directory (default: cwd)
  --no-open             Do not auto-open the browser
  -h, --help            Show help
  --version             Show version
```

### `k-files init`

Initialize a project for k-files tracking:

- Creates `.kfiles/config.json` with default settings
- Installs Claude Code hooks (if `.claude/` exists)
- Adds `.kfiles/` to `.gitignore`

```bash
k-files init
```

### `k-files install-hooks`

Install Claude Code hooks without initializing the full project:

```bash
k-files install-hooks
```

This creates two hook scripts in `.claude/hooks/` and updates `.claude/settings.json`:

- **`PostToolUse` hook** (matcher: `Edit|Write`) — records each file edit as a K-agent event with structured old/new diffs
- **`PreToolUse` hook** (matcher: `Write`) — snapshots the file content before overwrite for accurate diff computation

## How It Works

### Data Collection

k-files uses a layered strategy to capture file changes:

| Layer | Mechanism | Coverage |
|-------|-----------|----------|
| **Hook** | Claude Code `PostToolUse` / Cursor `afterFileEdit` | Structured edits with old/new strings |
| **File watch** | chokidar filesystem watcher | Any tool that writes files |
| **Reconciliation** | Periodic content hash scan | Catches missed events |

### Data Storage

All data is stored in the `.kfiles/` directory:

- `events.ndjson` — append-only event log (one JSON object per line per edit)
- `symbols.json` — file registry with metadata (IPO time, edit count, line count, content hash)
- `config.json` — ignore patterns and capture settings

### K-Line Mapping

| Stock Market | k-files |
|---|---|
| Stock ticker | A file in your project |
| IPO | First time a file is edited |
| Candlestick (K-line) | One edit round (OHLC = line count open/high/low/close) |
| Volume | Lines added or removed |
| ST delisting | File deleted from workspace |

### Architecture

```
Browser (localhost:13579)
  ├── cli-fallbacks.css    ← CSS variable defaults (Dark+ theme)
  ├── market.css           ← Original KFiles styles (unchanged)
  ├── lightweight-charts.js ← TradingView charting library
  ├── cli-bridge.js        ← VS Code API polyfill → WebSocket
  └── market.js            ← Original KFiles frontend (unchanged)
         ↕ WebSocket (JSON)
Server (Node.js)
  ├── HTTP server (6 routes)
  ├── WebSocket hub (ws)
  ├── File watcher (chokidar + 300ms debounce)
  ├── Snapshot manager (in-memory before-image cache)
  └── Core modules (reused from KFiles, zero vscode deps)
```

## Supported Agents

| Agent | Capture Method | Edit Granularity |
|---|---|---|
| **Claude Code** | `PostToolUse` hook + filesystem watch | Per-edit (old/new strings) |
| **Cursor** | `afterFileEdit` hook + filesystem watch | Per-edit (old/new strings) |
| **Codex CLI** | Filesystem watch only | Per-write (whole file) |
| **GitHub Copilot** | Filesystem watch only | Per-write (whole file) |
| **vim / any editor** | Filesystem watch only | Per-write (whole file) |
| **Manual edits** | Filesystem watch only | Per-write (whole file) |

## Configuration

Edit `.kfiles/config.json` to customize behavior:

```json
{
  "ignore": [
    "**/node_modules/**",
    "**/.git/**",
    "**/.kfiles/**",
    "**/dist/**",
    "**/out/**"
  ],
  "capture": {
    "onSave": true
  },
  "coalesceWindowMs": 1500
}
```

## Development

```bash
# Clone the repo
git clone https://github.com/adampan0527/k-files.git
cd k-files

# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/cli.js

# Sync vendor files from KAgent
npm run sync-vendor
```

## Relationship to KAgent

k-files is a standalone CLI extraction of [KAgent](../KAgent) — a VS Code/Cursor extension that visualizes AI agent edits as K-line charts. The core recording and candle-building logic is shared between both projects:

- **KAgent** runs inside VS Code/Cursor as a sidebar extension
- **k-files** runs independently as a CLI tool + web server

Both projects use the same `.kfiles/` data format, so they are fully interoperable.

## License

[GPL-3.0](LICENSE)
