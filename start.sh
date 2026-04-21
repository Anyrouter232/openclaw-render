#!/bin/sh
set -eu

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
PORT="${PORT:-${OPENCLAW_GATEWAY_PORT:-8080}}"

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

if [ ! -f "$STATE_DIR/openclaw.json" ]; then
  cp /app/openclaw.json "$STATE_DIR/openclaw.json"
fi

exec openclaw gateway --bind lan --port "$PORT" --allow-unconfigured
