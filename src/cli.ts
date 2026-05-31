#!/usr/bin/env node
/**
 * k-files — Standalone CLI for K-line file edit visualization
 *
 * Usage: k-files [command] [options]
 *
 * Commands:
 *   init                Create .kfiles/config.json and install Claude Code hooks
 *   install-hooks       Install Claude Code hooks only
 *
 * Options:
 *   -p, --port <number>   Port for the web server (default: 13579)
 *   -d, --dir <path>      Workspace root directory (default: cwd)
 *   --no-open             Do not auto-open the browser
 *   -h, --help            Show this help message
 *   --version             Show version number
 */

import * as fs from "node:fs";
import { join } from "node:path";
import { exec } from "node:child_process";
import { createServer, listen } from "./server";
import { WsHub } from "./wsHub";
import { FileRecorder } from "./record";
import { ensureKfilesConfig, loadKfilesConfig } from "./core/kfilesConfig";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const __dirname2 = __dirname; // available in CommonJS

function getVersion(): string {
  try {
    const pkgPath = join(__dirname2, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = getVersion();

// ---------------------------------------------------------------------------
// CLI option types & parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  subcommand?: "init" | "install-hooks";
  port: number;
  dir: string;
  open: boolean;
  help: boolean;
  version: boolean;
}

function printHelp(): void {
  console.log(`
k-files v${VERSION} — K-line file edit visualization

Usage: k-files [command] [options]

Commands:
  init                Create .kfiles/config.json and install Claude Code hooks
  install-hooks       Install Claude Code hooks only

Options:
  -p, --port <number>   Port for the web server (default: 13579)
  -d, --dir <path>      Workspace root directory (default: cwd)
  --no-open             Do not auto-open the browser
  -h, --help            Show this help message
  --version             Show version number

Examples:
  k-files                         Start watching current directory on port 13579
  k-files init                    Initialize project with hooks and config
  k-files install-hooks           Install Claude Code hooks only
  k-files -p 8080                 Start on port 8080
  k-files -d /path/to/project     Watch a specific directory
  k-files --no-open               Start server without opening browser
`);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    port: 13579,
    dir: process.cwd(),
    open: true,
    help: false,
    version: false,
  };

  // Check for subcommands (first non-flag argument)
  const firstArg = argv.find((a) => !a.startsWith("-"));
  if (firstArg === "init" || firstArg === "install-hooks") {
    opts.subcommand = firstArg;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--version":
        opts.version = true;
        break;
      case "--no-open":
        opts.open = false;
        break;
      case "-p":
      case "--port": {
        const val = argv[++i];
        if (!val || isNaN(Number(val))) {
          console.error("Error: --port requires a numeric value");
          process.exit(1);
        }
        opts.port = Number(val);
        break;
      }
      case "-d":
      case "--dir": {
        const val = argv[++i];
        if (!val) {
          console.error("Error: --dir requires a path value");
          process.exit(1);
        }
        opts.dir = val;
        break;
      }
      default:
        if (arg.startsWith("-")) {
          console.error(`Error: Unknown option '${arg}'. Use --help for usage.`);
          process.exit(1);
        }
        break;
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Hook installation
// ---------------------------------------------------------------------------

function installHooks(workspaceRoot: string): boolean {
  const claudeDir = join(workspaceRoot, ".claude");
  const hooksDir = join(claudeDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });

  // Copy hook scripts
  const srcHooksDir = join(__dirname2, "..", "src", "hooks");
  const scripts = ["claude-post-edit.mjs", "claude-snapshot.mjs"];

  for (const script of scripts) {
    const src = join(srcHooksDir, script);
    const dest = join(hooksDir, script);
    if (!fs.existsSync(src)) {
      console.error(`  Hook script not found: ${src}`);
      return false;
    }
    fs.copyFileSync(src, dest);
    console.log(`  Installed ${script}`);
  }

  // Update settings.json
  const settingsPath = join(claudeDir, "settings.json");
  let settings: Record<string, any> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  // Check if hooks are already installed
  const postExists = settings.hooks.PostToolUse.some(
    (h: any) => h.hooks?.some((hh: any) => hh.command?.includes("claude-post-edit"))
  );
  const preExists = settings.hooks.PreToolUse.some(
    (h: any) => h.hooks?.some((hh: any) => hh.command?.includes("claude-snapshot"))
  );

  if (!postExists) {
    settings.hooks.PostToolUse.push({
      matcher: "Edit|Write",
      hooks: [{ type: "command", command: "node .claude/hooks/claude-post-edit.mjs" }],
    });
  }
  if (!preExists) {
    settings.hooks.PreToolUse.push({
      matcher: "Write",
      hooks: [{ type: "command", command: "node .claude/hooks/claude-snapshot.mjs" }],
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  console.log(`  Updated ${settingsPath}`);

  return true;
}

// ---------------------------------------------------------------------------
// Init command
// ---------------------------------------------------------------------------

function initCommand(workspaceRoot: string): void {
  console.log("[k-files] Initializing project...\n");

  // Ensure .kfiles
  const kfilesDir = join(workspaceRoot, ".kfiles");
  fs.mkdirSync(kfilesDir, { recursive: true });
  ensureKfilesConfig(kfilesDir);
  console.log("  Created .kfiles/config.json");

  // Install hooks
  console.log("\n  Installing Claude Code hooks:");
  installHooks(workspaceRoot);

  // Update .gitignore
  const gitignorePath = join(workspaceRoot, ".gitignore");
  let gitignore = "";
  if (fs.existsSync(gitignorePath)) {
    gitignore = fs.readFileSync(gitignorePath, "utf8");
  }
  if (!gitignore.includes(".kfiles/")) {
    fs.appendFileSync(gitignorePath, "\n.kfiles/\n", "utf8");
    console.log("  Added .kfiles/ to .gitignore");
  }

  console.log("\n[k-files] Initialization complete!");
  console.log("  Run 'k-files' to start watching and open the dashboard.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    console.log(`k-files v${VERSION}`);
    process.exit(0);
  }

  // --- Validate workspace directory ---
  const workspaceRoot = opts.dir;
  if (!fs.existsSync(workspaceRoot)) {
    console.error(`Error: Directory does not exist: ${workspaceRoot}`);
    process.exit(1);
  }

  // --- Handle subcommands ---
  if (opts.subcommand === "init") {
    initCommand(workspaceRoot);
    process.exit(0);
  }
  if (opts.subcommand === "install-hooks") {
    console.log("[k-files] Installing Claude Code hooks:\n");
    if (installHooks(workspaceRoot)) {
      console.log("\n[k-files] Hooks installed successfully!");
    } else {
      console.error("\n[k-files] Hook installation failed.");
      process.exit(1);
    }
    process.exit(0);
  }

  // --- Ensure .kfiles directory and default config ---
  const kfilesDir = join(workspaceRoot, ".kfiles");
  fs.mkdirSync(kfilesDir, { recursive: true });
  ensureKfilesConfig(kfilesDir);

  // Load config (for ignore patterns, etc.)
  const config = loadKfilesConfig(kfilesDir);
  const ignorePatterns: string[] = config.ignore ?? [];

  // --- 1. Create HTTP server ---
  const server = createServer(VERSION);

  // --- 2. Create WebSocket hub (attaches to the http.Server) ---
  const wsHub = new WsHub(server, workspaceRoot);

  // --- 3. Create file recorder ---
  const recorder = new FileRecorder({
    workspaceRoot,
    ignorePatterns,
    debounceMs: 500,
  });

  // --- 4. Wire recorder data changes → WebSocket broadcast ---
  recorder.on("dataChanged", () => {
    wsHub.broadcastUpdate().catch((err: unknown) => {
      console.error("[k-files] Broadcast error:", (err as Error).message);
    });
  });

  // --- 5. Start the file recorder (begins watching) ---
  recorder.start();

  // --- 6. Start the HTTP server ---
  const actualPort = await listen(server, opts.port);
  const url = `http://localhost:${actualPort}`;
  console.log(`[k-files] Server running at ${url}`);
  console.log(`[k-files] Watching ${workspaceRoot}`);
  console.log(`[k-files] Press Ctrl+C to stop`);

  // --- 7. Auto-open browser ---
  if (opts.open) {
    const cmd =
      process.platform === "win32"
        ? `start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    exec(cmd, () => {
      // fire-and-forget; ignore errors (e.g. headless server)
    });
  }

  // --- 8. Graceful shutdown ---
  const shutdown = async () => {
    console.log("\n[k-files] Shutting down...");
    await recorder.stop();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
