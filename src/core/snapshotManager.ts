import * as fs from "node:fs";
import * as path from "node:path";

export interface SnapshotEntry {
  content: string;
  contentHash: number;
  lines: number;
}

/**
 * Manages in-memory content snapshots for computing before/after diffs.
 * This is the standalone equivalent of the lastRecordedContent Map in
 * KFiles's saveCapture.ts, driven by file system events instead of
 * VS Code's onDidSaveTextDocument.
 */
export class SnapshotManager {
  private snapshots = new Map<string, SnapshotEntry>();

  constructor(
    private workspaceRoot: string,
    private contentHashFn: (text: string) => number,
    private countLinesFn: (text: string) => number,
  ) {}

  /**
   * Load initial snapshots for a list of relative file paths.
   * Call once at startup before the watcher begins.
   */
  loadAll(files: string[]): void {
    for (const rel of files) {
      this.loadFile(rel);
    }
  }

  /**
   * Load/update snapshot for a single file from disk.
   */
  loadFile(relativeFile: string): void {
    const abs = path.join(this.workspaceRoot, relativeFile);
    try {
      if (!fs.existsSync(abs)) {
        this.snapshots.delete(relativeFile);
        return;
      }
      const content = fs.readFileSync(abs, "utf8");
      this.snapshots.set(relativeFile, {
        content,
        contentHash: this.contentHashFn(content),
        lines: this.countLinesFn(content),
      });
    } catch {
      // File unreadable; keep stale snapshot
    }
  }

  /**
   * Get the last-known content for diff computation.
   * Returns undefined if the file was never tracked (new file = "IPO").
   */
  getSnapshot(relativeFile: string): SnapshotEntry | undefined {
    return this.snapshots.get(relativeFile);
  }

  /**
   * After recording an event, update the snapshot to the current disk content.
   */
  updateAfterRecord(relativeFile: string): void {
    this.loadFile(relativeFile);
  }

  has(relativeFile: string): boolean {
    return this.snapshots.has(relativeFile);
  }

  delete(relativeFile: string): void {
    this.snapshots.delete(relativeFile);
  }

  /**
   * Get all tracked file paths.
   */
  files(): string[] {
    return Array.from(this.snapshots.keys());
  }

  /**
   * Get all entries for iteration.
   */
  entries(): IterableIterator<[string, SnapshotEntry]> {
    return this.snapshots.entries();
  }

  /**
   * Prime a snapshot with known content (e.g., from a hook payload).
   */
  prime(relativeFile: string, content: string): void {
    this.snapshots.set(relativeFile, {
      content,
      contentHash: this.contentHashFn(content),
      lines: this.countLinesFn(content),
    });
  }
}
