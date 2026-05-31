/**
 * server.ts — Lightweight HTTP server for k-files standalone CLI.
 *
 * Serves the K-line market UI as static HTML + vendor assets,
 * and exposes a `/ws` WebSocket endpoint via WsHub (attached by the caller).
 *
 * Design note:
 *   createServer() returns a bare http.Server with no WebSocket binding.
 *   The caller creates `new WsHub(server, workspaceRoot)` AFTER getting
 *   the server reference, because WsHub's constructor does
 *   `new WebSocketServer({ server, path: "/ws" })` which attaches to
 *   an existing http.Server.  Finally, call `listen(server, port)`.
 */

import * as http from "http";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths — assets are resolved relative to the package root (one level up from dist/)
// ---------------------------------------------------------------------------

const VENDOR_DIR = path.join(__dirname, "..", "vendor");
const STATIC_DIR = path.join(__dirname, "..", "static");

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Static file helper
// ---------------------------------------------------------------------------

function serveFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  const mime = getMimeType(filePath);
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

/**
 * Generate the full HTML document for the market view.
 * Derived from KFiles extension's marketViewProvider.getHtml() but adapted
 * for the standalone CLI context (no VS Code webview CSP, different asset paths).
 */
function generateHtml(version: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="/cli-fallbacks.css" />
  <link rel="stylesheet" href="/market.css" />
</head>
<body class="vscode-dark" data-color-scheme="cn" data-tone="dark" data-kfiles-version="${version}">
  <div id="banner" class="banner hidden"></div>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="toolbar-title">K-Files</span>
        <span id="symbol-count" class="muted">0</span>
      </div>
      <ul id="symbol-list" class="symbol-list"></ul>
      <p id="empty-hint" class="empty-hint">No symbols yet. Save a file or let the Agent make edits.</p>
    </aside>
    <main class="chart-panel">
      <div class="chart-header">
        <div id="chart-title" class="chart-title">Select a stock</div>
        <div class="chart-toolbar">
          <div class="scheme-switch" role="group" aria-label="Market color scheme">
            <button type="button" class="scheme-btn" data-scheme="cn" title="Red up, green down (CN)">A</button>
            <button type="button" class="scheme-btn" data-scheme="us" title="Green up, red down (US)">US</button>
          </div>
          <div class="scheme-switch tone-switch" role="group" aria-label="Light/dark mode">
            <button type="button" class="scheme-btn" data-tone="light" title="Light theme">Light</button>
            <button type="button" class="scheme-btn" data-tone="dark" title="Dark theme">Dark</button>
          </div>
        </div>
      </div>
      <div id="chart-legend" class="chart-legend muted">Open/Close = line count at start/end of edit round; a single round with delete+insert is split into two candles</div>
      <div id="ohlc-bar" class="ohlc-bar">
        <span class="ohlc-item"><em>Round</em><strong id="ohlc-round">--</strong></span>
        <span class="ohlc-item"><em>O</em><strong id="ohlc-open">--</strong></span>
        <span class="ohlc-item"><em>H</em><strong id="ohlc-high">--</strong></span>
        <span class="ohlc-item"><em>L</em><strong id="ohlc-low">--</strong></span>
        <span class="ohlc-item"><em>C</em><strong id="ohlc-close">--</strong></span>
        <span class="ohlc-item"><em>Vol</em><strong id="ohlc-volume">--</strong></span>
      </div>
      <div id="chart-error" class="chart-error hidden"></div>
      <div id="chart-container"></div>
    </main>
  </div>
  <script src="/lightweight-charts.js"></script>
  <script src="/cli-bridge.js"></script>
  <script src="/market.js"></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Create an http.Server that serves the k-files market UI.
 *
 * Routes:
 *   GET /                         → generated HTML (inline, not from disk)
 *   GET /index.html               → same
 *   GET /market.css               → vendor/market.css
 *   GET /market.js                → vendor/market.js
 *   GET /lightweight-charts.js    → vendor/lightweight-charts.js
 *   GET /cli-bridge.js            → static/cli-bridge.js
 *   GET /cli-fallbacks.css        → static/cli-fallbacks.css
 *
 * The server is returned WITHOUT calling .listen() — the caller is
 * responsible for attaching WsHub and then calling `listen()`.
 */
export function createServer(version: string): http.Server {
  const htmlContent = generateHtml(version);

  return http.createServer((req, res) => {
    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    switch (pathname) {
      case "/":
      case "/index.html": {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(htmlContent);
        return;
      }

      // Vendor assets (market.css, market.js, lightweight-charts.js)
      case "/market.css":
      case "/market.js":
      case "/lightweight-charts.js": {
        serveFile(res, path.join(VENDOR_DIR, pathname.slice(1)));
        return;
      }

      // Static CLI assets (cli-bridge.js, cli-fallbacks.css)
      case "/cli-bridge.js":
      case "/cli-fallbacks.css": {
        serveFile(res, path.join(STATIC_DIR, pathname.slice(1)));
        return;
      }

      default: {
        res.writeHead(404);
        res.end("Not Found");
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Listen helper
// ---------------------------------------------------------------------------

/**
 * Bind the server to `port`.  If that port is already in use (EADDRINUSE),
 * falls back to a random available port (port 0).
 *
 * @returns The actual port the server ended up listening on.
 */
export function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (resolved) return;

      if (err.code === "EADDRINUSE") {
        // Port taken — fall back to a random available port
        server.listen(0, "0.0.0.0", () => {
          if (resolved) return;
          resolved = true;
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : 0;
          resolve(actualPort);
        });
      } else {
        resolved = true;
        reject(err);
      }
    });

    server.listen(port, "0.0.0.0", () => {
      if (resolved) return;
      resolved = true;
      resolve(port);
    });
  });
}
