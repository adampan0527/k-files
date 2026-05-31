import * as fs from "fs";
import * as readline from "readline";
import { KfilesEvent, SymbolsFile } from "./types";
import { getEventsPath, getSymbolsPath } from "./paths";

export async function readAllEvents(kfilesDir: string): Promise<KfilesEvent[]> {
  const filePath = getEventsPath(kfilesDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const events: KfilesEvent[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as KfilesEvent);
    } catch {
      /* skip bad line */
    }
  }

  return events;
}

export function readSymbols(kfilesDir: string): SymbolsFile {
  const filePath = getSymbolsPath(kfilesDir);
  if (!fs.existsSync(filePath)) {
    return { symbols: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as SymbolsFile;
  } catch {
    return { symbols: {} };
  }
}
