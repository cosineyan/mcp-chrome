# Browser Proxy — Design & Implementation Record

## Background

The goal was to use `mcp-chrome`, which uses the official Native Messaging API and is already deployed as the main browser automation server.

## Architecture Overview

```
other-cli                       mcp-chrome
      |                             |
      | POST /browser               |
      +----> native server :12306   |
                   |                |
                   | Native Messaging (stdin/stdout)
                   +----> Chrome extension
                               |
                               | chrome.* APIs
                               +----> Browser
```

Two separate access paths exist in the native server:

| Path            | Protocol             | Consumer                                    |
| --------------- | -------------------- | ------------------------------------------- |
| `POST /mcp`     | JSON-RPC / SSE (MCP) | AI models, mcp-cli                          |
| `POST /browser` | Plain JSON           | Local trusted programs (other-cli, scripts) |

The `/browser` proxy was added specifically for local programmatic callers that need low-overhead access without the MCP protocol envelope.

## `/browser` Proxy Commands

### Existing commands (before this session)

| Command     | Description                                                               |
| ----------- | ------------------------------------------------------------------------- |
| `sessions`  | List all open tabs (id, url, title)                                       |
| `new-tab`   | Open a new tab, returns tabId as `sessionId`                              |
| `exec`      | Execute a predefined JS operation in a tab (operation name, not raw code) |
| `close-tab` | Close a tab by tabId                                                      |

### New commands added

#### `get-cookies`

```json
POST /browser
{ "command": "get-cookies", "domain": "coursera.org" }

→ { "ok": true,
    "cookieHeader": "CAUTH=xxx; csrf_token=yyy; ...",
    "cookies": [{ "name": "CAUTH", "value": "xxx", "httpOnly": true, ... }] }
```

Uses `chrome.cookies.getAll({ domain })` in the extension background — captures **all** cookies including `HttpOnly` ones that are inaccessible to `document.cookie`. The `cookieHeader` field is a pre-formatted `Cookie: ...` string ready to paste into a `fetch()` headers object for server-side requests.

#### `fetch`

```json
POST /browser
{ "command": "fetch",
  "url": "https://api.coursera.org/api/...",
  "method": "GET",
  "headers": { "accept": "application/json" },
  "body": null,
  "timeout": 30 }

→ { "ok": true, "statusCode": 200, "headers": {...}, "body": {...} }
```

Sends the request from inside the Chrome extension service worker using `fetch(url, { credentials: 'include' })`. Because the extension runs in the browser's trusted context and has `host_permissions: ["<all_urls>"]`, cookies for the target domain are automatically attached — no explicit cookie extraction needed.

## Implementation Details

### Files changed

| File                                                         | Change                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `packages/shared/src/types.ts`                               | Added `GET_COOKIES` and `FETCH_FROM_TAB` to `NativeMessageType` enum          |
| `app/chrome-extension/wxt.config.ts`                         | Added `"cookies"` to `permissions` array                                      |
| `app/chrome-extension/entrypoints/background/native-host.ts` | Added two `else if` handlers in the `nativePort.onMessage` listener           |
| `app/native-server/src/server/index.ts`                      | Added `get-cookies` and `fetch` command blocks in `setupBrowserProxyRoutes()` |

### Why a new `NativeMessageType` instead of reusing `CALL_TOOL`

`get-cookies` has no equivalent MCP tool — exposing raw cookie values to an AI model is inappropriate. A dedicated `NativeMessageType` keeps it out of the MCP tool system entirely.

`fetch` overlaps with the existing `chrome_network_request` MCP tool, but going through `CALL_TOOL` adds the MCP tool dispatch overhead and returns data wrapped in `content[0].text` JSON. A direct native message type gives a cleaner response shape for programmatic callers.

### Why `cookies` permission is required

`chrome.cookies.getAll()` requires the `cookies` permission in the manifest. The extension previously only had `webRequest` (which observes cookies in network traffic but does not allow direct API access to the cookie store).

### `credentials: 'include'` in FETCH_FROM_TAB

Extension service worker `fetch()` does not include cookies by default (same as normal `fetch()`). Explicitly setting `credentials: 'include'` is required for the browser to attach the user's cookies for the target origin.

## `get-cookies` vs `fetch` — When to Use Which

| Situation                                                           | Use                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Need to make many server-side calls; Chrome can be closed afterward | `get-cookies` → store the header → Node.js fetch                                      |
| Making occasional calls; always want the freshest session           | `fetch` → extension handles auth automatically                                        |
| The API checks request origin / TLS fingerprint                     | `fetch` (request comes from Chrome, not Node.js)                                      |
| The API returns large binary data                                   | `fetch` is impractical (goes through Native Messaging size limits); use `get-cookies` |

## `mcp-cli` Tool

`chrome-proxy/mcp-chrome-cli.js` is a zero-dependency Node.js CLI that calls any MCP tool via the Streamable HTTP transport.

```
node mcp-chrome-cli.js list                               # list all tools
node mcp-chrome-cli.js help <tool>                        # show input schema
node mcp-chrome-cli.js call <tool> [--arg k=v] [--json '{}'] [--raw]
```

It is **not** a wrapper around `/browser` — it speaks the MCP JSON-RPC protocol (`POST /mcp`) and is intended for ad-hoc tool invocation or scripting against the MCP tool set.

### Why `get-cookies` and `fetch` are NOT in `TOOL_SCHEMAS`

The MCP tools are consumed by AI models. Exposing raw `HttpOnly` cookie values to a model is a security concern. The `/browser` proxy commands are for local trusted callers only (same host, no auth), which is why they live behind a separate endpoint with no MCP tool schema.

## Token Extraction for other-cli

The Microsoft 365 token flow does not use cookie extraction. MSAL stores access tokens in `localStorage`, so the path is:

1. `exec` command → predefined operation `'outlook'` or `'teams_rt'`
2. Extension injects a compiled TypeScript function (not `eval`) into the Outlook/Teams tab in `world: 'MAIN'`
3. Function reads `localStorage`, finds MSAL entries, returns `{ graph, rest }` or `{ refreshToken }`
4. other-cli caches the Bearer token in `~/.other-cli/tokens.json`
5. All subsequent API calls use the Bearer token directly from Node.js (no browser needed)

This path bypasses the need for cookie extraction entirely.
