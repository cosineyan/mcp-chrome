# 🚀 Installation and Connection Issues

## Quick Diagnosis

Run the diagnostic tool to identify common issues:

```bash
mcp-chrome-bridge doctor
```

To automatically fix common issues:

```bash
mcp-chrome-bridge doctor --fix
```

## Export Report for GitHub Issues

If you need to open an issue, export a diagnostic report:

```bash
# Print Markdown report to terminal (copy/paste into GitHub Issue)
mcp-chrome-bridge report

# Write to a file
mcp-chrome-bridge report --output mcp-report.md

# Copy directly to clipboard
mcp-chrome-bridge report --copy
```

By default, usernames, paths, and tokens are redacted. Use `--no-redact` if you're comfortable sharing full paths.

## If Connection Fails After Clicking the Connect Button on the Extension

1. **Run the diagnostic tool first**

```bash
mcp-chrome-bridge doctor
```

This will check installation, manifest, permissions, and Node.js path.

2. **Check if mcp-chrome-bridge is installed successfully**, ensure it's globally installed

```bash
mcp-chrome-bridge -V
```

<img width="612" alt="Screenshot 2025-06-11 15 09 57" src="https://github.com/user-attachments/assets/59458532-e6e1-457c-8c82-3756a5dbb28e" />

2. **Check if the manifest file is in the correct directory**

Windows path: C:\Users\xxx\AppData\Roaming\Google\Chrome\NativeMessagingHosts

Mac path: /Users/xxx/Library/Application\ Support/Google/Chrome/NativeMessagingHosts

If the npm package is installed correctly, a file named `com.chromemcp.nativehost.json` should be generated in this directory

3. **Check logs**
   Logs are now stored in user-writable directories:

- **macOS**: `~/Library/Logs/mcp-chrome-bridge/`
- **Windows**: `%LOCALAPPDATA%\mcp-chrome-bridge\logs\`
- **Linux**: `~/.local/state/mcp-chrome-bridge/logs/`

<img width="804" alt="Screenshot 2025-06-11 15 09 41" src="https://github.com/user-attachments/assets/ce7b7c94-7c84-409a-8210-c9317823aae1" />

4. **Check if you have execution permissions**
   You need to check your installation path (if unclear, open the manifest file in step 2, the path field shows the installation directory). For example, if the Mac installation path is as follows:

`xxx/node_modules/mcp-chrome-bridge/dist/run_host.sh`

Check if this script has execution permissions. Run to fix:

```bash
mcp-chrome-bridge fix-permissions
```

5. **Node.js not found**
   If you use a Node version manager (nvm, volta, asdf, fnm), the wrapper script may not find Node.js. Set the `CHROME_MCP_NODE_PATH` environment variable:

```bash
export CHROME_MCP_NODE_PATH=/path/to/your/node
```

Or run `mcp-chrome-bridge doctor --fix` to write the current Node path.

## macOS: "Native host has exited" with exit code 126

**Symptom**: Clicking Connect in the extension popup shows "Native host has exited." in the console. The wrapper log shows:

```
bash: /opt/homebrew/.../run_host.sh: Operation not permitted
```

or exit code 126 from the run_host script.

**Cause**: On macOS, Chrome's process tree is subject to TCC (Transparency, Consent, and Control) sandbox restrictions. When Chrome launches the Native Messaging host via `bash`, macOS blocks execution of shell scripts located at paths like `/opt/homebrew/` or `~/Documents/`. This is not a file-permission problem (`chmod 755` does not fix it) — it is a path-based security policy.

Affected paths (blocked):

- `/opt/homebrew/lib/node_modules/mcp-chrome-bridge/dist/run_host.sh`
- `~/Documents/.../.../run_host.sh`

Allowed path:

- `~/Library/Application Scripts/mcp-chrome-bridge/run_host.sh`

**Fix**: Re-run the register command. Starting from this fix, `mcp-chrome-bridge register` automatically sets up a launcher directory at `~/Library/Application Scripts/mcp-chrome-bridge/` and points the manifest there.

```bash
mcp-chrome-bridge register
```

If you need to restore it manually, copy the three files:

```bash
LAUNCHER_DIR="$HOME/Library/Application Scripts/mcp-chrome-bridge"
DIST_DIR="/opt/homebrew/lib/node_modules/mcp-chrome-bridge/dist"   # adjust if needed

mkdir -p "$LAUNCHER_DIR"
cp "$DIST_DIR/run_host.sh" "$LAUNCHER_DIR/"
cp "$DIST_DIR/node_path.txt" "$LAUNCHER_DIR/"
chmod 755 "$LAUNCHER_DIR/run_host.sh"

# Write a proxy index.js so node_modules paths inside the real index.js still resolve
echo "\"use strict\"; require('$DIST_DIR/index.js');" > "$LAUNCHER_DIR/index.js"
```

Then update the manifest path field to `~/Library/Application Scripts/mcp-chrome-bridge/run_host.sh`.

---

## Local Development: Registering a Dev Extension ID

When loading the Chrome extension in developer mode (without publishing to the Chrome Web Store), Chrome assigns a random extension ID. The Native Messaging host manifest must include this ID in `allowed_origins` or the connection will be rejected.

**Step 1**: Find your dev extension ID in `chrome://extensions` (enable Developer mode, then copy the ID under your unpacked extension).

**Step 2**: Register with your dev ID:

```bash
mcp-chrome-bridge register --extension-id <your-dev-extension-id>
```

**Step 3** (optional, for a stable ID across rebuilds): Set `CHROME_EXTENSION_KEY` in `app/chrome-extension/.env.local`. This encodes a fixed public key into the extension manifest so Chrome always assigns the same ID regardless of the load path.

---

## Log Locations

Wrapper logs are now stored in user-writable locations:

- **macOS**: `~/Library/Logs/mcp-chrome-bridge/`
- **Windows**: `%LOCALAPPDATA%\mcp-chrome-bridge\logs\`
- **Linux**: `~/.local/state/mcp-chrome-bridge/logs/`
