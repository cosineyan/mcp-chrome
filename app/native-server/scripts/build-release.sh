#!/bin/bash
# build-release.sh — Build standalone macOS binaries for GitHub Releases
#
# Produces:
#   releases/native-server/mcp-chrome-bridge-macos-arm64
#   releases/native-server/mcp-chrome-bridge-macos-x64
#
# Usage (from repo root):
#   pnpm --filter mcp-chrome-bridge build:release
# Or from this package's directory:
#   bash scripts/build-release.sh

set -e

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"
OUT_DIR="$REPO_ROOT/releases/native-server"
PKG="$PACKAGE_DIR/node_modules/.bin/pkg"

echo "==> Building TypeScript..."
cd "$PACKAGE_DIR"
npm run build

echo ""
echo "==> Packaging binaries with @yao-pkg/pkg..."
mkdir -p "$OUT_DIR"

# Build arm64 and x64 separately for explicit output naming
"$PKG" dist/cli.js \
  --targets node22-macos-arm64 \
  --output "$OUT_DIR/mcp-chrome-bridge-macos-arm64" \
  --config package.json

"$PKG" dist/cli.js \
  --targets node22-macos-x64 \
  --output "$OUT_DIR/mcp-chrome-bridge-macos-x64" \
  --config package.json

chmod +x "$OUT_DIR/mcp-chrome-bridge-macos-arm64"
chmod +x "$OUT_DIR/mcp-chrome-bridge-macos-x64"

echo ""
echo "=== Release binaries ready ==="
ls -lh "$OUT_DIR"/mcp-chrome-bridge-macos-*
echo ""
echo "Upload these files to GitHub Releases:"
echo "  $OUT_DIR/mcp-chrome-bridge-macos-arm64"
echo "  $OUT_DIR/mcp-chrome-bridge-macos-x64"
