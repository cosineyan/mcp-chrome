#!/bin/bash
# Install mcp-chrome: build native server + register native messaging host.
# The Chrome extension must be loaded manually (Chrome UI only).
#
# Usage:
#   ./install.sh                        # guided (prompts for extension ID)
#   ./install.sh --extension-id <id>    # non-interactive

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_SERVER_DIR="$REPO_DIR/app/native-server"
EXTENSION_DIR="$REPO_DIR/releases/chrome-extension/latest"
EXTENSION_ZIP="$EXTENSION_DIR/chrome-mcp-server-lastest.zip"
EXTENSION_UNPACKED="$EXTENSION_DIR/unpacked"

# --- Parse args ---
EXTENSION_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id) EXTENSION_ID="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "=== mcp-chrome installer ==="
echo ""

# --- Step 1: Unpack extension (if not already done) ---
if [ ! -d "$EXTENSION_UNPACKED" ]; then
  echo "==> Unpacking Chrome extension..."
  mkdir -p "$EXTENSION_UNPACKED"
  unzip -q "$EXTENSION_ZIP" -d "$EXTENSION_UNPACKED"
  echo "    Unpacked to: $EXTENSION_UNPACKED"
else
  echo "==> Extension already unpacked: $EXTENSION_UNPACKED"
fi

# --- Step 2: Prompt user to load extension in Chrome ---
if [ -z "$EXTENSION_ID" ]; then
  echo ""
  echo "------------------------------------------------------------"
  echo " MANUAL STEP: Load the extension in Chrome"
  echo "------------------------------------------------------------"
  echo " 1. Open Chrome → chrome://extensions/"
  echo " 2. Enable 'Developer mode' (top-right toggle)"
  echo " 3. Click 'Load unpacked' → select this folder:"
  echo "    $EXTENSION_UNPACKED"
  echo " 4. Copy the Extension ID shown on the extension card"
  echo "------------------------------------------------------------"
  echo ""
  read -rp "Paste the Extension ID here: " EXTENSION_ID
  if [ -z "$EXTENSION_ID" ]; then
    echo "Error: Extension ID is required."
    exit 1
  fi
fi

# --- Step 3: Build native server ---
echo ""
echo "==> Building native server..."
cd "$NATIVE_SERVER_DIR"
if [ ! -d "node_modules" ]; then
  npm install -q
fi
npm run build --silent
echo "    Build complete."

# --- Step 4: Install (npm link) ---
echo ""
echo "==> Installing mcp-chrome-bridge globally..."
npm link --silent
echo "    Installed: $(mcp-chrome-bridge --version)"

# --- Step 5: Register native messaging host ---
echo ""
echo "==> Registering native messaging host..."
mcp-chrome-bridge register --extension-id "$EXTENSION_ID" --force
echo ""
echo "=== Done! ==="
echo ""
echo "Next steps:"
echo "  1. Click the extension icon in Chrome → Connect"
echo "  2. Copy the MCP config shown in the popup into your Claude Code settings"
echo "  3. Restart Claude Code"
