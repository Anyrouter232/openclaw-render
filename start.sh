#!/bin/sh
set -eu

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
CONFIG_SOURCE="${OPENCLAW_CONFIG_SOURCE:-/app/openclaw.json}"
PORT="${PORT:-${OPENCLAW_GATEWAY_PORT:-10000}}"
TOKEN="${OPENCLAW_GATEWAY_TOKEN:-openclaw-render-zahir-2026}"

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

cp "$CONFIG_SOURCE" "$STATE_DIR/openclaw.json"

exec openclaw gateway run \
  --bind lan \
  --port "$PORT" \
  --auth token \
  --token "$TOKEN" \
  --allow-unconfigured
