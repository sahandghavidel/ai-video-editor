#!/usr/bin/env bash
set -euo pipefail

APP_PORT="9540"
MINIO_DATA_DIR="/Users/sahand/Docker/minio-data"
MINIO_API_ADDR=":9000"
MINIO_CONSOLE_ADDR=":9001"
MINIO_LOG_FILE="/tmp/minio-dev.log"

read_env_local_value() {
  local key="$1"
  local env_file=".env.local"

  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  local line
  line=$(grep -E "^${key}=" "$env_file" | tail -n 1 || true)
  if [[ -z "$line" ]]; then
    return 0
  fi

  # Return everything after the first '=' exactly as-is.
  printf '%s' "${line#*=}"
}

# Never hardcode secrets in source-controlled scripts.
MINIO_ROOT_USER="${MINIO_ROOT_USER:-$(read_env_local_value MINIO_ROOT_USER)}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-admin}"
: "${MINIO_DATA_DIR:=${MINIO_DATA_DIR:-$(read_env_local_value MINIO_DATA_DIR)}}"
: "${MINIO_DATA_DIR:=/Users/sahand/Docker/minio-data}"
: "${MINIO_API_ADDR:=${MINIO_API_ADDR:-$(read_env_local_value MINIO_API_ADDR)}}"
: "${MINIO_API_ADDR:=:9000}"
: "${MINIO_CONSOLE_ADDR:=${MINIO_CONSOLE_ADDR:-$(read_env_local_value MINIO_CONSOLE_ADDR)}}"
: "${MINIO_CONSOLE_ADDR:=:9001}"
: "${MINIO_LOG_FILE:=${MINIO_LOG_FILE:-$(read_env_local_value MINIO_LOG_FILE)}}"
: "${MINIO_LOG_FILE:=/tmp/minio-dev.log}"
: "${MINIO_ROOT_PASSWORD:=${MINIO_ROOT_PASSWORD:-$(read_env_local_value MINIO_ROOT_PASSWORD)}}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required (set it in your shell env or .env.local)}"

cleanup() {
  # Stop Next dev started by this script (if still running)
  if [[ -n "${NEXT_PID:-}" ]] && kill -0 "$NEXT_PID" 2>/dev/null; then
    kill "$NEXT_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[dev] Stopping previous Next.js dev on port ${APP_PORT} (if any)..."
pkill -f "next dev.*${APP_PORT}" || true

# Important: user requested Next.js first, then MinIO.
echo "[dev] Starting Next.js on port ${APP_PORT}..."
next dev -p "$APP_PORT" &
NEXT_PID=$!

# Give Next a brief head start and fail fast if it exited.
sleep 1
if ! kill -0 "$NEXT_PID" 2>/dev/null; then
  echo "[dev] Next.js failed to start. Aborting MinIO startup."
  wait "$NEXT_PID"
fi

echo "[dev] Restarting MinIO..."
pkill -f "minio server ${MINIO_DATA_DIR}" || true

MINIO_ROOT_USER="$MINIO_ROOT_USER" \
MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
nohup minio server "$MINIO_DATA_DIR" \
  --address "$MINIO_API_ADDR" \
  --console-address "$MINIO_CONSOLE_ADDR" \
  >"$MINIO_LOG_FILE" 2>&1 &

echo "[dev] MinIO started. Logs: ${MINIO_LOG_FILE}"
echo "[dev] MinIO API: http://localhost:9000"
echo "[dev] MinIO Console: http://localhost:9001"

# Keep this command attached to Next.js lifecycle.
wait "$NEXT_PID"
