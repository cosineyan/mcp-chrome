#!/bin/bash
# install.sh — Install mcp-chrome-bridge and Chrome extension from GitHub Releases
#
# Downloads the pre-built bridge tgz and extension tgz, extracts them,
# runs npm link, and registers the Native Messaging Host. Safe to run
# multiple times (idempotent) — skips download if already up to date.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/cosineyan/mcp-chrome/master/install.sh | bash
#   # or with a specific version:
#   curl -fsSL ... | bash -s -- --tag v1.0.6
#   # or from the cloned repo:
#   ./install.sh
#
# Options:
#   --tag <tag>       Release tag to install (default: v1.0.5)
#   --bridge-dir <d>  Where to extract bridge (default: ~/mcp-chrome-bridge)
#   --plugin-dir <d>  Where to extract extension (default: ~/Downloads/mcp-chrome-plugin)
#   --force           Re-download even if already installed with same version
#   --skip-register   Skip Native Messaging Host registration
#   --skip-plugin     Skip Chrome extension download

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────
TAG="v1.0.7"
BRIDGE_DIR="$HOME/mcp-chrome-bridge"
PLUGIN_DIR="$HOME/Downloads/mcp-chrome-plugin"
FORCE=false
SKIP_REGISTER=false
SKIP_PLUGIN=false
REPO="cosineyan/mcp-chrome"

# ─── Parse args ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)           TAG="$2"; shift 2 ;;
    --bridge-dir)    BRIDGE_DIR="$2"; shift 2 ;;
    --plugin-dir)    PLUGIN_DIR="$2"; shift 2 ;;
    --force)         FORCE=true; shift ;;
    --skip-register) SKIP_REGISTER=true; shift ;;
    --skip-plugin)   SKIP_PLUGIN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

BASE_URL="https://github.com/$REPO/releases/download/$TAG"

# ─── Helpers ─────────────────────────────────────────────────────────
info()  { printf "\033[34m==> %s\033[0m\n" "$*"; }
ok()    { printf "\033[32m  ✓ %s\033[0m\n" "$*"; }
warn()  { printf "\033[33m  ⚠ %s\033[0m\n" "$*"; }
err()   { printf "\033[31m  ✗ %s\033[0m\n" "$*"; }

check_node() {
  if ! command -v node &>/dev/null; then
    err "Node.js not found. Install Node.js >= 20: https://nodejs.org/"
    exit 1
  fi
  local major
  major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$major" -lt 20 ] 2>/dev/null; then
    err "Node.js v$major found, but >= 20 is required."
    exit 1
  fi
  ok "Node.js $(node --version)"
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    err "npm not found. Install Node.js which includes npm."
    exit 1
  fi
  ok "npm $(npm --version)"
}

# Read version from an installed bridge's package.json (empty if absent)
installed_bridge_version() {
  if [ -f "$BRIDGE_DIR/package.json" ]; then
    node -e "console.log(require('$BRIDGE_DIR/package.json').version)" 2>/dev/null || true
  fi
}

# Read installed extension manifest.json version (empty if absent)
installed_plugin_version() {
  if [ -f "$PLUGIN_DIR/manifest.json" ]; then
    node -e "console.log(JSON.parse(require('fs').readFileSync('$PLUGIN_DIR/manifest.json','utf8')).version)" 2>/dev/null || true
  fi
}

# Read the .install-tag marker (records which release tag was installed)
installed_tag() {
  if [ -f "$BRIDGE_DIR/.install-tag" ]; then
    cat "$BRIDGE_DIR/.install-tag"
  fi
}

# ─── Preflight ───────────────────────────────────────────────────────
echo ""
info "mcp-chrome installer ($TAG)"
echo ""
check_node
check_npm

# ─── Step 1: Install mcp-chrome-bridge ───────────────────────────────
echo ""
info "Step 1: Install mcp-chrome-bridge"

CURRENT_TAG="$(installed_tag)"
CURRENT_BRIDGE="$(installed_bridge_version)"
NEED_DOWNLOAD=true
NEED_LINK=false

if [ -n "$CURRENT_BRIDGE" ] && [ "$CURRENT_TAG" = "$TAG" ] && [ "$FORCE" = false ]; then
  ok "Bridge already installed (v$CURRENT_BRIDGE, $TAG) at $BRIDGE_DIR"
  NEED_DOWNLOAD=false
  # Still check if npm link is intact
  if command -v mcp-chrome-bridge &>/dev/null; then
    ok "mcp-chrome-bridge on PATH"
  else
    warn "mcp-chrome-bridge not on PATH — will re-link"
    NEED_LINK=true
  fi
elif [ -n "$CURRENT_BRIDGE" ]; then
  info "Upgrading bridge: v$CURRENT_BRIDGE ($CURRENT_TAG) → $TAG"
fi

if [ "$NEED_DOWNLOAD" = true ]; then
  TMP_TGZ="$(mktemp /tmp/mcp-chrome-bridge.XXXXXX.tgz)"

  info "Downloading bridge..."
  if ! curl -fsSL --connect-timeout 15 "$BASE_URL/mcp-chrome-bridge.tgz" -o "$TMP_TGZ"; then
    rm -f "$TMP_TGZ"
    err "Download failed. Check network access to github.com."
    err "If on a corporate network, try a personal hotspot or VPN."
    exit 1
  fi
  ok "Downloaded ($(du -h "$TMP_TGZ" | cut -f1 | tr -d ' '))"

  # Remove old installation, extract fresh
  rm -rf "$BRIDGE_DIR"
  mkdir -p "$BRIDGE_DIR"
  tar -xzf "$TMP_TGZ" --strip-components=1 -C "$BRIDGE_DIR"
  rm -f "$TMP_TGZ"
  ok "Extracted to $BRIDGE_DIR"

  # Write tag marker for future idempotency checks
  echo "$TAG" > "$BRIDGE_DIR/.install-tag"

  NEED_LINK=true
fi

if [ "$NEED_LINK" = true ]; then
  info "Running npm link..."
  (cd "$BRIDGE_DIR" && npm link 2>&1 | grep -v "^npm warn" || true)
fi

# Verify
if command -v mcp-chrome-bridge &>/dev/null; then
  ok "mcp-chrome-bridge $(mcp-chrome-bridge --version)"
else
  err "npm link finished but mcp-chrome-bridge not on PATH."
  err "Try: export PATH=\"\$(npm config get prefix)/bin:\$PATH\""
  exit 1
fi

# ─── Step 2: Register Native Messaging Host ──────────────────────────
echo ""
if [ "$SKIP_REGISTER" = false ]; then
  info "Step 2: Register Native Messaging Host"
  mcp-chrome-bridge register --force 2>&1 | grep -E "✓|Success|registered" || true
  ok "Native Messaging Host registered"
else
  info "Step 2: Skipped (--skip-register)"
fi

# ─── Step 3: Download Chrome extension ───────────────────────────────
echo ""
if [ "$SKIP_PLUGIN" = false ]; then
  info "Step 3: Download Chrome extension"

  CURRENT_PLUGIN="$(installed_plugin_version)"
  if [ -n "$CURRENT_PLUGIN" ] && [ "$FORCE" = false ] && [ -f "$PLUGIN_DIR/.install-tag" ] && [ "$(cat "$PLUGIN_DIR/.install-tag")" = "$TAG" ]; then
    ok "Extension already installed (v$CURRENT_PLUGIN, $TAG) at $PLUGIN_DIR"
  else
    if [ -n "$CURRENT_PLUGIN" ]; then
      info "Upgrading extension from v$CURRENT_PLUGIN..."
    fi

    TMP_PLUGIN="$(mktemp /tmp/mcp-chrome-plugin.XXXXXX.tgz)"
    info "Downloading extension..."
    if ! curl -fsSL --connect-timeout 15 "$BASE_URL/mcp-chrome-plugin.tgz" -o "$TMP_PLUGIN"; then
      rm -f "$TMP_PLUGIN"
      err "Download failed. Check network access to github.com."
      exit 1
    fi
    ok "Downloaded ($(du -h "$TMP_PLUGIN" | cut -f1 | tr -d ' '))"

    rm -rf "$PLUGIN_DIR"
    mkdir -p "$PLUGIN_DIR"
    tar -xzf "$TMP_PLUGIN" -C "$PLUGIN_DIR"
    rm -f "$TMP_PLUGIN"
    echo "$TAG" > "$PLUGIN_DIR/.install-tag"
    ok "Extracted to $PLUGIN_DIR"
  fi
else
  info "Step 3: Skipped (--skip-plugin)"
fi

# ─── Done ────────────────────────────────────────────────────────────
echo ""
info "Installation complete!"
echo ""
echo "  Next steps (Chrome UI — cannot be automated):"
echo ""
echo "  1. Open Chrome → chrome://extensions/"
echo "  2. Enable Developer mode (top-right toggle)"
if [ "$SKIP_PLUGIN" = false ]; then
  echo "  3. Click 'Load unpacked' → select: $PLUGIN_DIR"
fi
echo "     Extension ID: kcjeddeiaabcfmjcnfmiamacmlmfkjdl (deterministic)"
echo "  4. Click the extension icon → Connect"
echo ""
echo "  Verify: curl -s http://127.0.0.1:12306/ping"
echo ""
