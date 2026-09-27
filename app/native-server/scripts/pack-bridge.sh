#!/bin/bash
# pack-bridge.sh — Package the pre-built native-server as a self-contained tgz
#
# Produces:
#   releases/mcp-chrome-bridge.tgz
#
# The tarball contains everything needed to run mcp-chrome-bridge with Node.js:
#   mcp-chrome-bridge/
#     package.json          (rewritten: workspace:* → file: refs removed)
#     dist/                 (compiled JS + run_host.sh)
#     node_modules/         (production deps, real files not pnpm symlinks)
#
# After extracting, the user just runs:
#   cd mcp-chrome-bridge && npm link
#
# Usage:
#   From repo root:   pnpm --filter mcp-chrome-bridge pack:release
#   From this dir:    bash scripts/pack-bridge.sh

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"
OUT_DIR="$REPO_ROOT/releases"
STAGE_DIR="$(mktemp -d)"
BRIDGE_DIR="$STAGE_DIR/mcp-chrome-bridge"

cleanup() { rm -rf "$STAGE_DIR"; }
trap cleanup EXIT

# Build unless --no-build is passed (useful when dist/ is already up to date)
if [[ "${1:-}" != "--no-build" ]]; then
  echo "==> Building TypeScript..."
  cd "$PACKAGE_DIR"
  npm run build
else
  echo "==> Skipping build (--no-build), using existing dist/..."
  cd "$PACKAGE_DIR"
  if [ ! -d dist ] || [ ! -f dist/cli.js ]; then
    echo "ERROR: dist/ not found or incomplete. Run 'npm run build' first."
    exit 1
  fi
fi

echo ""
echo "==> Staging release package..."
mkdir -p "$BRIDGE_DIR"

# 1. Copy dist/
cp -R dist "$BRIDGE_DIR/dist"

# 2. Remove dev-only files from dist
rm -f "$BRIDGE_DIR/dist/node_path.txt"

# 3. Bundle chrome-mcp-shared (workspace package) into node_modules
mkdir -p "$BRIDGE_DIR/node_modules/chrome-mcp-shared"
cp "$REPO_ROOT/packages/shared/package.json" "$BRIDGE_DIR/node_modules/chrome-mcp-shared/"
cp -R "$REPO_ROOT/packages/shared/dist" "$BRIDGE_DIR/node_modules/chrome-mcp-shared/dist"

# 4. Create a clean package.json for the tarball
#    - Replace "chrome-mcp-shared": "workspace:*" with a file: reference
#    - Strip devDependencies (not needed at runtime)
#    - Strip pkg config (not needed for Node.js execution)
node -e "
const pkg = require('./package.json');
// Remove workspace dep — it's bundled in node_modules already
delete pkg.dependencies['chrome-mcp-shared'];
// Strip dev-only fields
delete pkg.devDependencies;
delete pkg.pkg;
delete pkg.husky;
delete pkg['lint-staged'];
delete pkg.scripts.dev;
delete pkg.scripts.test;
delete pkg.scripts['test:watch'];
delete pkg.scripts.lint;
delete pkg.scripts['lint:fix'];
delete pkg.scripts.format;
delete pkg.scripts['build:release'];
delete pkg.scripts['register:dev'];
// Keep build + postinstall scripts for npm link to work
const out = JSON.stringify(pkg, null, 2) + '\n';
require('fs').writeFileSync('$BRIDGE_DIR/package.json', out);
"

# 5. Install production dependencies (real files, not pnpm symlinks)
echo ""
echo "==> Installing production dependencies..."
cd "$BRIDGE_DIR"
npm install --production --ignore-scripts 2>&1 | tail -5

# 6. Prune bloat from node_modules
echo ""
echo "==> Pruning unnecessary files..."

#    chrome-devtools-frontend (~77MB) — only used by trace-analyzer (non-critical)
rm -rf "$BRIDGE_DIR/node_modules/chrome-devtools-frontend"

#    @img/sharp-* (~15MB) — image processing, not used by native-server
rm -rf "$BRIDGE_DIR/node_modules/@img"
rm -rf "$BRIDGE_DIR/node_modules/sharp"

#    claude-agent-sdk vendor/ripgrep (~53MB) — bundled rg binaries for all platforms
#    only keep the current platform's binary
RIPGREP_DIR="$BRIDGE_DIR/node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep"
if [ -d "$RIPGREP_DIR" ]; then
  ARCH="$(uname -m)"
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  KEEP=""
  case "$ARCH-$OS" in
    arm64-darwin)  KEEP="arm64-darwin" ;;
    x86_64-darwin) KEEP="x64-darwin"   ;;
    aarch64-linux) KEEP="arm64-linux"  ;;
    x86_64-linux)  KEEP="x64-linux"    ;;
  esac
  if [ -n "$KEEP" ]; then
    for d in "$RIPGREP_DIR"/*/; do
      name="$(basename "$d")"
      if [ "$name" != "$KEEP" ] && [ "$name" != "COPYING" ]; then
        rm -rf "$d"
      fi
    done
  fi
fi

#    sql.js — only need sql-wasm.js + sql-wasm.wasm; prune debug/asm/browser/zip variants
SQLJS_DIST="$BRIDGE_DIR/node_modules/sql.js/dist"
if [ -d "$SQLJS_DIST" ]; then
  find "$SQLJS_DIST" -type f \
    ! -name "sql-wasm.js" \
    ! -name "sql-wasm.wasm" \
    -delete
fi

#    @types/ — not needed at runtime
rm -rf "$BRIDGE_DIR/node_modules/@types"

#    Remove package-lock.json (npm artifact)
rm -f "$BRIDGE_DIR/package-lock.json"
rm -rf "$BRIDGE_DIR/node_modules/.package-lock.json"

# 8. tar it up
echo ""
echo "==> Creating tarball..."
mkdir -p "$OUT_DIR"
cd "$STAGE_DIR"
tar -czf "$OUT_DIR/mcp-chrome-bridge.tgz" mcp-chrome-bridge

SIZE=$(du -sh "$OUT_DIR/mcp-chrome-bridge.tgz" | cut -f1)
echo ""
echo "=== Release package ready ==="
echo "  $OUT_DIR/mcp-chrome-bridge.tgz ($SIZE)"
echo ""
echo "Install with:"
echo "  tar -xzf mcp-chrome-bridge.tgz"
echo "  cd mcp-chrome-bridge && npm link"
echo "  mcp-chrome-bridge --version"
