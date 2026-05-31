import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "events";
import { SnapshotManager } from "./core/snapshotManager";
import { recordFileChange } from "./core/recordChange";
import { contentHash, countLines } from "./core/lineStats";
import { readSymbols } from "./core/eventStore";
import { getSymbolsPath } from "./core/paths";
import { SymbolsFile } from "./core/types";
import { FileWatcher, WatcherOptions } from "./watcher";

/**
 * contentHash returns a hex string, but SnapshotManager expects
 * a numeric hash function. This wrapper converts the hex string
 * to a base-10 integer so it satisfies `(text: string) => number`.
 */
function numericContentHash(text: string): number {
  return parseInt(contentHash(text), 16);
}

export interface RecordOptions {
  workspaceRoot: string;
  ignorePatterns: string[];
  debounceMs: number;
}

/**
 * Orchestrates file watching, snapshot management, and event recording.
 * This is the standalone equivalent of KFiles's saveCapture.ts + snapshotSync.ts.
 */
export class FileRecorder extends EventEmitter {
  private snapshotManager: SnapshotManager;
  private watcher: FileWatcher;
  private workspaceRoot: string;

  constructor(private opts: RecordOptions) {
    super();
    this.workspaceRoot = opts.workspaceRoot;
    this.snapshotManager = new SnapshotManager(
      opts.workspaceRoot,
      numericContentHash,
      countLines,
    );
    this.watcher = new FileWatcher({
      workspaceRoot: opts.workspaceRoot,
      ignorePatterns: opts.ignorePatterns,
      debounceMs: opts.debounceMs,
    });
  }

  /**
   * Initialize: load existing tracked files into snapshot, start watcher.
   */
  start(): void {
    // 1. Load snapshots from symbols.json (previously tracked files)
    const kfilesDir = path.join(this.workspaceRoot, ".kfiles");
    const symbolsPath = getSymbolsPath(kfilesDir);

    if (fs.existsSync(symbolsPath)) {
      try {
        const doc = readSymbols(kfilesDir);
        const trackedFiles = Object.keys(doc.symbols);
        this.snapshotManager.loadAll(trackedFiles);
        console.log(`[k-files] Loaded snapshots for ${trackedFiles.length} tracked files`);
      } catch (err) {
        console.warn("[k-files] Could not load symbols.json:", (err as Error).message);
      }
    }

    // 2. Listen for watcher events
    this.watcher.on("change", (event: { type: string; relativeFile: string }) => {
      this.handleChange(event.type, event.relativeFile);
    });

    // 3. Start watching
    this.watcher.start();
    console.log(`[k-files] Watching ${this.workspaceRoot}`);
  }

  private handleChange(eventType: string, relativeFile: string): void {
    const absPath = path.join(this.workspaceRoot, relativeFile);

    // Handle file deletion
    if (eventType === "unlink" || !fs.existsSync(absPath)) {
      const snapshot = this.snapshotManager.getSnapshot(relativeFile);
      if (snapshot) {
        recordFileChange({
          workspaceRoot: this.workspaceRoot,
          relativeFile,
          linesAfter: 0,
          oldText: snapshot.content,
          source: "fileWatch" as any,
          actor: "unknown",
        });
        this.snapshotManager.delete(relativeFile);
        this.emit("dataChanged");
      }
      return;
    }

    // Read current file content
    let currentContent: string;
    try {
      currentContent = fs.readFileSync(absPath, "utf8");
    } catch {
      return; // unreadable
    }

    const currentHash = numericContentHash(currentContent);
    const snapshot = this.snapshotManager.getSnapshot(relativeFile);

    // Skip if content unchanged (touch/utime events, format-no-change)
    if (snapshot && snapshot.contentHash === currentHash) {
      return;
    }

    // Record the change
    const oldText = snapshot?.content ?? "";
    const linesAfter = countLines(currentContent);

    // For new files (no snapshot), don't pass oldText so recordFileChange treats it as IPO
    if (!snapshot) {
      recordFileChange({
        workspaceRoot: this.workspaceRoot,
        relativeFile,
        linesAfter,
        source: "fileWatch" as any,
        actor: "unknown",
      });
    } else {
      recordFileChange({
        workspaceRoot: this.workspaceRoot,
        relativeFile,
        linesAfter,
        oldText,
        source: "fileWatch" as any,
        actor: "unknown",
      });
    }

    // Update snapshot to current content
    this.snapshotManager.updateAfterRecord(relativeFile);
    this.emit("dataChanged");
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
  }

  getSnapshotManager(): SnapshotManager {
    return this.snapshotManager;
  }
}
