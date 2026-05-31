import * as fs from "node:fs";
import * as path from "node:path";

export interface KfilesConfigFile {
  ignore?: string[];
  capture?: {
    onSave?: boolean;
  };
  coalesceWindowMs?: number;
}

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.kfiles/**",
  "**/dist/**",
  "**/out/**",
];

const DEFAULT_COALESCE_WINDOW_MS = 1500;

export function defaultConfigFile(): KfilesConfigFile {
  return {
    ignore: DEFAULT_IGNORE,
    capture: { onSave: true },
    coalesceWindowMs: DEFAULT_COALESCE_WINDOW_MS,
  };
}

export function loadKfilesConfig(kfilesDir: string): KfilesConfigFile {
  const configPath = path.join(kfilesDir, "config.json");
  if (!fs.existsSync(configPath)) return defaultConfigFile();
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return { ...defaultConfigFile(), ...JSON.parse(raw) };
  } catch {
    return defaultConfigFile();
  }
}

export function getCoalesceWindowMs(kfilesDir: string | undefined): number {
  if (!kfilesDir) return DEFAULT_COALESCE_WINDOW_MS;
  return loadKfilesConfig(kfilesDir).coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
}

export function ensureKfilesConfig(kfilesDir: string): void {
  const configPath = path.join(kfilesDir, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfigFile(), null, 2), "utf8");
  }
}

export function globToRegExp(pattern: string): RegExp {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/<<GLOBSTAR>>/g, ".*");
  return new RegExp(`^${re}$`);
}

export function isIgnored(relativePath: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(relativePath));
}

export function isCaptureOnSaveEnabled(kfilesDir: string | undefined): boolean {
  if (!kfilesDir) return true;
  return loadKfilesConfig(kfilesDir).capture?.onSave !== false;
}

export function getWorkspaceKfilesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".kfiles");
}
