# AnnieDrawing MCP example

This separate local package exposes AnnieDrawing's six agent tools over the MCP stdio transport. It can edit a headless document or a live browser board. It is included in this repository as `anniedrawing-mcp` 0.1.0 (`private: true`). It does not assume a second repository exists.

## Install and run headless

From the repository root:

```sh
npm ci
npm run build
npm ci --prefix examples/mcp
node examples/mcp/server.mjs
```

The process waits for newline-delimited JSON-RPC on stdin. Stdout contains protocol messages only. Configure an MCP client to launch `node` with the absolute path to `examples/mcp/server.mjs` as an argument. No HTTP MCP endpoint is created.

To read a file, add `--document /absolute/path/drawing.annie`. Add `--persist` to write successful commits back to that same file using an atomic temporary-file rename. Without `--persist`, changes remain in memory until the server exits. Dry runs never persist. The file must already exist and validate. Current documents use format version 2 with `pages`. Version 1 files with `sheets` migrate in memory when loaded. The next successful persisted edit writes version 2 while preserving IDs and content.

A minimal protocol conversation sends each of these objects on one line, in order:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"board_describe","arguments":{"detail":"normal"}}}
```

Page edits use the current `page.*` operations and `page` destination property:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "board_apply",
    "arguments": {
      "ops": [
        { "op": "page.add", "page": { "id": "p_plan", "name": "Plan", "items": [] } },
        {
          "op": "add",
          "page": "p_plan",
          "item": { "id": "i_next", "kind": "note", "text": { "value": "Next step" } }
        }
      ],
      "origin": "agent:planner"
    }
  }
}
```

`board_snapshot` and `board_view_fit` return an error in headless mode because they require a browser. Other tools use the same model and schemas as the library. An unsuccessful `board_apply` result becomes a tool result with `isError: true`. A successful agent apply that reuses an item id still commits; the stored id is `id_1` (then `_2`), the result includes `ID_REMAPPED`, and `created` lists the stored ids.

## Connect a live board

Start the demo and note its exact origin. In a second terminal, generate a session token and launch the bridge:

```sh
export ANNIEDRAWING_BRIDGE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export ANNIEDRAWING_BRIDGE_ORIGIN='http://localhost:YOUR_DEMO_PORT'
node examples/mcp/server.mjs --live
```

Use the actual demo origin, including its scheme, hostname, and port. The server prints a randomly assigned address to stderr, such as `ws://127.0.0.1:49123/bridge`. To choose a known available port, pass `--port <port>`. The server fails if that port is already in use. Bindings always use loopback.

An MCP client needs those two environment variables in its server configuration, not merely a different shell. Keep the chosen token private. In the board's browser context, attach the bridge:

```js
const { attachLiveBridge } = await import('/examples/mcp/bridge.mjs');
const board = window.__anniedrawing[0];
const disconnect = attachLiveBridge(board, {
  url: 'ws://127.0.0.1:49123/bridge',
  token: 'PASTE_YOUR_PRIVATE_SESSION_TOKEN_HERE',
  onStatus: console.info,
});
// When the session is finished:
// disconnect()
```

That URL works through the repository's Vite development server after the library build. A packaged production app should copy or adapt `bridge.mjs` and import `runTool` from `anniedrawing/agent`. Never embed a token in shipped source. HTTPS pages may reject an insecure local WebSocket under their own browser policy. Use the local development origin for this example.

The bridge requires a token of at least 32 characters, an exact allowed browser origin, explicit authentication, and a single active board. It does not reconnect itself or connect silently. Reading or editing a live board through this bridge is deliberate access to the user's data. The application must make that authorization clear.

If a mutation times out or the board disconnects, read the board before retrying. The change may already have committed. Connecting another board requires disconnecting the first. Readonly still applies to live operations.

## Verify

```sh
npm test --prefix examples/mcp
# With Chromium installed for Playwright:
node examples/mcp/live-smoke.mjs
```

The tests exercise protocol initialization, discovery, operation rollback, page operations, version 1 migration, headless persistence, origin and token rejection, live forwarding, and disconnect errors. The browser smoke check connects the actual demo, commits a real operation, fits the camera, and verifies a labeled PNG result through MCP. Protocol behavior follows the official [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) and [tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) specifications. Supported negotiated versions are 2025-06-18, 2025-03-26, and 2024-11-05.

For an independently published MCP package, replace local `../../dist` imports with a versioned AnnieDrawing dependency and review its own distribution and release procedure. This example remains `private: true`.
