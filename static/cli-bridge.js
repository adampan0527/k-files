/**
 * cli-bridge.js — VS Code API polyfill for k-files standalone server.
 * Loaded before market.js. Provides acquireVsCodeApi() shim that
 * routes messages over WebSocket instead of VS Code's postMessage.
 */
(function () {
  var wsUrl = "ws://" + location.host + "/ws";
  var ws = null;
  var reconnectTimer = null;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
      console.log("[k-files] WebSocket connected");
      // Send ready signal so the server sends the initial marketUpdate payload.
      // Without this, market.js's "ready" postMessage may fire before the WS
      // is open and be silently dropped, leaving the page blank until the user
      // toggles US/A (which triggers another broadcastUpdate).
      ws.send(JSON.stringify({ type: "ready" }));
    };

    ws.onmessage = function (event) {
      var data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      // Dispatch as a MessageEvent on window, exactly like VS Code does
      window.dispatchEvent(new MessageEvent("message", { data: data }));
    };

    ws.onclose = function () {
      console.warn("[k-files] WebSocket closed. Reconnecting in 2s...");
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(function () {
          reconnectTimer = null;
          connect();
        }, 2000);
      }
    };

    ws.onerror = function () {
      // onclose will fire after this
    };
  }

  connect();

  // Polyfill acquireVsCodeApi — market.js calls this on line 2
  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data));
        }
      },
      getState: function () {
        return undefined;
      },
      setState: function () {
        /* noop */
      },
    };
  };
})();
