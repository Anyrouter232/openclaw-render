#!/bin/sh
set -eu

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
CONFIG_SOURCE="${OPENCLAW_CONFIG_SOURCE:-/app/openclaw.json}"
BOOT_SCRIPT="${OPENCLAW_BOOT_SCRIPT:-/app/boot.mjs}"

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

if [ ! -f "$STATE_DIR/openclaw.json" ]; then
  cp "$CONFIG_SOURCE" "$STATE_DIR/openclaw.json"
fi

exec node "$BOOT_SCRIPT"
