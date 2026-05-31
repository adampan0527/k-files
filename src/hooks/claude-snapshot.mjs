#!/usr/bin/env node
/**
 * k-files Claude Code PreToolUse hook (Write tool).
 * Snapshots the current file content BEFORE it gets overwritten.
 * This allows the PostToolUse hook to compute accurate diffs.
 *
 * Install in .claude/settings.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       {
 *         "matcher": "Write",
 *         "hooks": [{ "type": "command", "command": "node .claude/hooks/claude-snapshot.mjs" }]
 *       }
 *     ]
 *   }
 * }
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const cwd = payload.cwd || process.cwd();
const toolInput = payload.tool_input || {};

if (!toolInput.file_path) {
  process.exit(0);
}

const absolutePath = toolInput.file_path;
const relativeFile = relative(cwd, absolutePath).split("\\").join("/");

// Read current file content (before overwrite)
let currentContent = "";
try {
  currentContent = readFileSync(absolutePath, "utf8");
} catch {
  // File doesn't exist yet — that's fine, it's a new file
}

// Save snapshot
const snapshotDir = join(cwd, ".kfiles", "snapshots");
mkdirSync(snapshotDir, { recursive: true });

// Use a safe filename (replace path separators with underscores)
const safeName = relativeFile.replace(/[\/\\]/g, "_");
const snapshotPath = join(snapshotDir, `${safeName}.snapshot.json`);

const snapshot = {
  file: relativeFile,
  content: currentContent,
  lines: currentContent ? currentContent.split("\n").length : 0,
  ts: Date.now(),
};

try {
  writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
} catch (err) {
  console.error("[k-files hook] Failed to save snapshot:", err.message);
}

process.exit(0);
