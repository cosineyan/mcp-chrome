#!/usr/bin/env python3
"""Detect whether the mcp-chrome extension is installed and connected.

Two-tier detection (see docs/EXTENSION_ID_AND_DETECTION_zh.md):
  1. Port probe  http://127.0.0.1:12306/ping  -> "ready" (installed AND connected)
  2. Read-only Chrome "Secure Preferences"    -> distinguish
     "installed-not-running" from "not-installed"

Read-only. Never writes Chrome preferences (they carry HMAC tamper protection).

Exit codes:
  0  ready                 extension installed and native host reachable
  1  installed-not-running installed (unpacked) but port 12306 not answering
  2  not-installed         no matching unpacked extension found
  3  error                 unexpected failure

Usage:
  detect-mcp-chrome.py [--json] [--plugin-dir DIR ...] [--port 12306]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.request

DEFAULT_PLUGIN_DIRS = [
    os.path.expanduser("~/mcp-chrome/app/chrome-extension/.output/chrome-mv3"),
    os.path.expanduser("~/Downloads/mcp-chrome-plugin"),
]

# Chrome extension "location" enum values seen in Secure Preferences.
LOCATION_UNPACKED = 4


def ping(port: int, timeout: float = 2.0) -> bool:
    """Return True if the native-server bridge answers /ping with pong."""
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/ping", timeout=timeout
        ) as resp:
            body = resp.read().decode("utf-8", "replace")
        return '"pong"' in body or '"ok"' in body
    except Exception:
        return False


def chrome_base() -> str:
    """Chrome user-data dir on macOS. Override with CHROME_USER_DATA_DIR."""
    return os.environ.get(
        "CHROME_USER_DATA_DIR",
        os.path.expanduser("~/Library/Application Support/Google/Chrome"),
    )


def find_unpacked(plugin_dirs) -> dict | None:
    """Scan every profile's Secure Preferences for an unpacked extension
    whose load path matches one of plugin_dirs. Match by path (not name/ID):
    unpacked extensions do not cache manifest.name here, and the ID is not
    deterministic until a fixed `key` is embedded. Returns the ID via the key.
    """
    wanted = {os.path.realpath(p) for p in plugin_dirs}
    for pref in glob.glob(os.path.join(chrome_base(), "*", "Secure Preferences")):
        try:
            with open(pref, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        settings = data.get("extensions", {}).get("settings", {})
        for ext_id, meta in settings.items():
            if meta.get("location") != LOCATION_UNPACKED:
                continue
            path = meta.get("path")
            if path and os.path.realpath(path) in wanted:
                return {
                    "id": ext_id,
                    "path": path,
                    "profile": os.path.basename(os.path.dirname(pref)),
                }
    return None


def detect(plugin_dirs, port) -> dict:
    if ping(port):
        return {"status": "ready", "code": 0}
    match = find_unpacked(plugin_dirs)
    if match:
        return {"status": "installed-not-running", "code": 1, **match}
    return {"status": "not-installed", "code": 2}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a word")
    ap.add_argument("--port", type=int, default=12306, help="bridge port (default 12306)")
    ap.add_argument("--plugin-dir", action="append", dest="plugin_dirs", metavar="DIR",
                    help="unpacked load dir to match (repeatable; overrides defaults)")
    args = ap.parse_args()

    plugin_dirs = args.plugin_dirs or DEFAULT_PLUGIN_DIRS
    try:
        result = detect(plugin_dirs, args.port)
    except Exception as exc:  # pragma: no cover
        if args.json:
            print(json.dumps({"status": "error", "code": 3, "error": str(exc)}))
        else:
            print("error", file=sys.stderr)
        return 3

    if args.json:
        print(json.dumps(result))
    else:
        print(result["status"])
    return result["code"]


if __name__ == "__main__":
    sys.exit(main())
