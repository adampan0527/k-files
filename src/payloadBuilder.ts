import * as fs from "node:fs";
import * as path from "node:path";
import { readAllEvents, readSymbols } from "./core/eventStore";
import { buildMarketPayload } from "./core/candleBuilder";
import { syncDelistedSymbols } from "./core/symbolDelist";
import { loadKfilesConfig } from "./core/kfilesConfig";
import { MarketPayload, SymbolSummary } from "./core/types";

export interface PayloadOptions {
  workspaceRoot: string;
  selectedFile?: string;
  colorScheme?: string;
  colorTone?: string;
}

export interface FullPayload extends MarketPayload {
  hooksOk: boolean;
  captureOnSave: boolean;
  captureEnabled: boolean;
  kfilesDir: string;
  colorScheme: string;
  colorTone: string;
}

/**
 * Assemble the full MarketPayload for the webview.
 * This is the standalone equivalent of MarketViewProvider.loadPayload().
 */
export async function loadPayload(opts: PayloadOptions): Promise<FullPayload> {
  const workspaceRoot = opts.workspaceRoot;
  const kfilesDir = path.join(workspaceRoot, ".kfiles");

  // Read events and symbols
  const events = await readAllEvents(kfilesDir);
  let symbolsDoc = readSymbols(kfilesDir);

  // Sync delisted symbols (mark missing files)
  try {
    symbolsDoc = syncDelistedSymbols(kfilesDir, workspaceRoot);
  } catch {
    /* lock conflict - continue with previously read symbols */
  }

  // Build market payload using the core candle builder
  const market = buildMarketPayload(
    events,
    symbolsDoc,
    opts.selectedFile ?? null,
    workspaceRoot,
  );

  // Detect missing files
  const missingFiles: string[] = [];
  for (const s of market.symbols as SymbolSummary[]) {
    const absPath = path.join(workspaceRoot, s.file);
    if (!fs.existsSync(absPath)) {
      s.is_delisted = true;
      missingFiles.push(s.file);
    }
  }

  // Check hook status
  const hooksOk = fs.existsSync(
    path.join(workspaceRoot, ".cursor", "hooks.json"),
  );

  // Check capture config
  const config = loadKfilesConfig(kfilesDir);
  const captureOnSave = config.capture?.onSave !== false;

  return {
    ...market,
    missingFiles,
    hooksOk,
    captureOnSave,
    captureEnabled: hooksOk || captureOnSave,
    kfilesDir,
    colorScheme: opts.colorScheme ?? "cn",
    colorTone: opts.colorTone ?? "dark",
  };
}
