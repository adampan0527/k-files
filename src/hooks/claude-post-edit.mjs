#!/usr/bin/env node
/**
 * k-files Claude Code PostToolUse hook.
 * Invoked after Edit or Write tool calls.
 * Reads hook payload from stdin, records the event to .kfiles/
 *
 * Install in .claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [
 *       {
 *         "matcher": "Edit|Write",
 *         "hooks": [{ "type": "command", "command": "node .claude/hooks/claude-post-edit.mjs" }]
 *       }
 *     ]
 *   }
 * }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";

// --- Read stdin ---
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0); // malformed input, silently ignore
}

const cwd = payload.cwd || process.cwd();
const toolName = payload.tool_name;
const toolInput = payload.tool_input || {};

if (!toolInput.file_path) {
  process.exit(0);
}

const absolutePath = toolInput.file_path;
const relativeFile = relative(cwd, absolutePath).split("\\").join("/");

// --- Helpers (same logic as kfiles-record.mjs) ---

function countLines(text) {
  if (!text || text.length === 0) return 0;
  return text.split("\n").length;
}

function contentHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function readCurrentFile() {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return "";
  }
}

// --- Load or init .kfiles data ---

const kfilesDir = join(cwd, ".kfiles");
mkdirSync(kfilesDir, { recursive: true });

const eventsPath = join(kfilesDir, "events.ndjson");
const symbolsPath = join(kfilesDir, "symbols.json");
const lockPath = join(kfilesDir, ".lock");

function readSymbols() {
  try {
    return JSON.parse(readFileSync(symbolsPath, "utf8"));
  } catch {
    return { symbols: {} };
  }
}

function saveSymbols(doc) {
  writeFileSync(symbolsPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

// --- Compute stats ---

const currentContent = readCurrentFile();
const linesAfter = countLines(currentContent);
const hashAfter = contentHash(currentContent);

let added = 0;
let removed = 0;

if (toolName === "Edit" && toolInput.old_string !== undefined && toolInput.new_string !== undefined) {
  // Structured edit — count line diffs from the edit patch
  added = countLines(toolInput.new_string);
  removed = countLines(toolInput.old_string);
} else if (toolName === "Write") {
  // Full file write — we know the "after" but not the "before"
  // Record as IPO or use existing last_lines
}

const symbolsDoc = readSymbols();
const existing = symbolsDoc.symbols[relativeFile];
const isIpo = !existing;
const linesBefore = existing?.last_lines ?? 0;

if (toolName === "Write" && existing) {
  added = Math.max(0, linesAfter - linesBefore);
  removed = Math.max(0, linesBefore - linesAfter);
}

const net = added - removed;
const linesHigh = Math.max(linesBefore, linesAfter);
const linesLow = Math.min(linesBefore, linesAfter);
const editCount = (existing?.edit_count ?? 0) + 1;
const ts = Date.now();

const event = {
  v: 2,
  ts,
  conversation_id: payload.session_id ?? null,
  generation_id: null,
  file: relativeFile,
  added,
  removed,
  net,
  lines_before: linesBefore,
  lines_after: linesAfter,
  lines_high: linesHigh,
  lines_low: linesLow,
  is_ipo: isIpo,
  edit_index: editCount,
  source: "afterFileEdit",
  actor: "agent",
  editor: "claude-code",
  content_hash_after: hashAfter,
};

// --- Write event (append to ndjson) ---
try {
  const line = JSON.stringify(event) + "\n";
  const existing_events = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "";
  writeFileSync(eventsPath, existing_events + line, "utf8");
} catch (err) {
  console.error("[k-files hook] Failed to write event:", err.message);
}

// --- Update symbols ---
symbolsDoc.symbols[relativeFile] = {
  ipo_ts: existing?.ipo_ts ?? ts,
  edit_count: editCount,
  last_lines: linesAfter,
  last_ts: ts,
  delisted: false,
  last_source: "afterFileEdit",
  last_content_hash: hashAfter,
};

try {
  saveSymbols(symbolsDoc);
} catch (err) {
  console.error("[k-files hook] Failed to save symbols:", err.message);
}

process.exit(0);
