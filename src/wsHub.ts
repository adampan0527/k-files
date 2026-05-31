import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { loadPayload, PayloadOptions, FullPayload } from "./payloadBuilder";

interface ClientState {
  selectedFile?: string;
  colorScheme: string;
  colorTone: string;
}

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientState>();
  private workspaceRoot: string;

  constructor(
    server: import("http").Server,
    workspaceRoot: string,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
      this.clients.set(ws, {
        colorScheme: "cn",
        colorTone: "dark",
      });

      ws.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(ws, msg);
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });
  }

  private async handleMessage(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    const state = this.clients.get(ws);
    if (!state) return;

    switch (msg.type) {
      case "ready": {
        // Send initial payload
        const payload = await this.buildPayload(state);
        this.send(ws, { type: "marketUpdate", payload });
        break;
      }
      case "selectSymbol": {
        state.selectedFile = msg.file as string | undefined;
        const payload = await this.buildPayload(state);
        this.send(ws, { type: "marketUpdate", payload });
        break;
      }
      case "setColorScheme": {
        state.colorScheme = msg.scheme as string;
        // Broadcast to all clients
        await this.broadcastUpdate();
        break;
      }
      case "setColorTone": {
        state.colorTone = msg.tone as string;
        await this.broadcastUpdate();
        break;
      }
    }
  }

  private send(ws: WebSocket, data: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private async buildPayload(state: ClientState): Promise<FullPayload> {
    return loadPayload({
      workspaceRoot: this.workspaceRoot,
      selectedFile: state.selectedFile,
      colorScheme: state.colorScheme,
      colorTone: state.colorTone,
    });
  }

  /**
   * Broadcast market update to all connected clients.
   * Called by the watcher when data changes.
   */
  async broadcastUpdate(): Promise<void> {
    for (const [ws, state] of this.clients) {
      try {
        const payload = await this.buildPayload(state);
        this.send(ws, { type: "marketUpdate", payload });
      } catch (err) {
        console.error("[k-files] Error building payload:", (err as Error).message);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
