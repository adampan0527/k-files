import chokidar, { FSWatcher } from "chokidar";
import path from "path";
import { EventEmitter } from "events";

export interface WatcherOptions {
  workspaceRoot: string;
  ignorePatterns: string[];
  debounceMs: number;
}

export interface FileChangeEvent {
  type: "change" | "add" | "unlink";
  relativeFile: string;
}

/**
 * Creates a file system watcher using chokidar.
 * Emits "change" events with relative file paths after debouncing.
 */
export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private timers = new Map<string, NodeJS.Timeout>();
  private debounceMs: number;
  private workspaceRoot: string;

  constructor(private opts: WatcherOptions) {
    super();
    this.debounceMs = opts.debounceMs;
    this.workspaceRoot = opts.workspaceRoot;
  }

  start(): void {
    // Always-ignored patterns
    const alwaysIgnored = [
      /(^|[\/\\])\../,  // dotfiles/dirs (.git, .kfiles, etc.)
      "**/node_modules/**",
      "**/.kfiles/**",
    ];

    this.watcher = chokidar.watch(this.workspaceRoot, {
      ignored: [...alwaysIgnored, ...this.opts.ignorePatterns],
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      // Chokidar v4 uses awaitWriteFinish to handle atomic writes
      awaitWriteFinish: {
        stabilityThreshold: this.opts.debounceMs,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", (filePath: string) => {
      this.scheduleEvent("change", filePath);
    });

    this.watcher.on("add", (filePath: string) => {
      this.scheduleEvent("add", filePath);
    });

    this.watcher.on("unlink", (filePath: string) => {
      this.scheduleEvent("unlink", filePath);
    });

    this.watcher.on("error", (error: unknown) => {
      console.error("[k-files] Watcher error:", error instanceof Error ? error.message : String(error));
    });
  }

  private scheduleEvent(type: "change" | "add" | "unlink", filePath: string): void {
    const rel = path.relative(this.workspaceRoot, filePath).split(path.sep).join("/");

    // Cancel any pending callback for this file
    const existing = this.timers.get(rel);
    if (existing) clearTimeout(existing);

    this.timers.set(
      rel,
      setTimeout(() => {
        this.timers.delete(rel);
        this.emit("change", { type, relativeFile: rel } as FileChangeEvent);
      }, this.debounceMs)
    );
  }

  async stop(): Promise<void> {
    // Flush pending timers
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
