#!/bin/bash
# Install mcp-chrome: native server + native messaging host registration.
# The Chrome extension must be loaded manually (Chrome UI only).
#
# Usage:
#   ./install.sh                        # guided (prompts for extension ID)
#   ./install.sh --extension-id <id>    # non-interactive
#   ./install.sh --local-build          # skip prebuilt download, build from source

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_SERVER_DIR="$REPO_DIR/app/native-server"
EXTENSION_DIR="$REPO_DIR/releases/chrome-extension/latest"
EXTENSION_ZIP="$EXTENSION_DIR/chrome-mcp-server-lastest.zip"
EXTENSION_UNPACKED="$EXTENSION_DIR/unpacked"
PREBUILT_DIR="$REPO_DIR/releases/native-server"

GITHUB_REPO="cosineyan/mcp-chrome"
GITHUB_RELEASES_BASE="https://github.com/$GITHUB_REPO/releases/latest/download"

# --- Parse args ---
EXTENSION_ID=""
FORCE_LOCAL_BUILD=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id) EXTENSION_ID="$2"; shift 2 ;;
    --local-build)  FORCE_LOCAL_BUILD=true; shift ;;
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

# --- Step 3: Resolve native server binary ---
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)             BINARY_NAME="mcp-chrome-bridge-macos-arm64" ;;
  x86_64 | i386)    BINARY_NAME="mcp-chrome-bridge-macos-x64" ;;
  *)
    echo "Warning: unknown arch '$ARCH', falling back to x64 binary."
    BINARY_NAME="mcp-chrome-bridge-macos-x64" ;;
esac

NATIVE_BIN=""

if [ "$FORCE_LOCAL_BUILD" = false ]; then
  # 3a. Check for locally available prebuilt binary
  LOCAL_PREBUILT="$PREBUILT_DIR/$BINARY_NAME"
  if [ -x "$LOCAL_PREBUILT" ]; then
    echo ""
    echo "==> Using local prebuilt binary: $LOCAL_PREBUILT"
    NATIVE_BIN="$LOCAL_PREBUILT"
  else
    # 3b. Try downloading from GitHub Releases
    DOWNLOAD_URL="$GITHUB_RELEASES_BASE/$BINARY_NAME"
    DOWNLOAD_DEST="$PREBUILT_DIR/$BINARY_NAME"
    echo ""
    echo "==> Downloading prebuilt binary ($ARCH)..."
    echo "    $DOWNLOAD_URL"
    mkdir -p "$PREBUILT_DIR"
    if curl -fsSL --connect-timeout 15 -o "$DOWNLOAD_DEST" "$DOWNLOAD_URL" 2>/dev/null; then
      chmod +x "$DOWNLOAD_DEST"
      echo "    Downloaded: $DOWNLOAD_DEST"
      NATIVE_BIN="$DOWNLOAD_DEST"
    else
      echo "    Download failed (no release published yet, or no internet). Falling back to local build."
    fi
  fi
fi

# 3c. Fallback: build from source
if [ -z "$NATIVE_BIN" ]; then
  echo ""
  echo "==> Building native server from source..."
  cd "$NATIVE_SERVER_DIR"
  if [ ! -d "node_modules" ]; then
    npm install -q
  fi
  npm run build --silent
  echo ""
  echo "==> Installing mcp-chrome-bridge globally..."
  npm link --silent
  echo "    Installed: $(mcp-chrome-bridge --version)"
  NATIVE_BIN="$(command -v mcp-chrome-bridge)"
fi

# --- Step 4: Register native messaging host ---
echo ""
echo "==> Registering native messaging host..."
"$NATIVE_BIN" register --extension-id "$EXTENSION_ID" --force
echo ""
echo "=== Done! ==="
echo ""
echo "Next steps:"
echo "  1. Click the extension icon in Chrome → Connect"
echo "  2. Copy the MCP config shown in the popup into your Claude Code settings"
echo "  3. Restart Claude Code"
