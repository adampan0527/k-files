import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Get the .kfiles directory path, given a workspace root.
 * Creates the directory if it doesn't exist.
 */
export function getKfilesDir(workspaceRoot: string): string {
  const dir = path.join(workspaceRoot, ".kfiles");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getEventsPath(kfilesDir: string): string {
  return path.join(kfilesDir, "events.ndjson");
}

export function getSymbolsPath(kfilesDir: string): string {
  return path.join(kfilesDir, "symbols.json");
}
