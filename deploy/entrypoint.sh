#!/usr/bin/env bash
set -Eeuo pipefail

server_pid=""
nginx_pid=""

terminate() {
  trap - TERM INT
  if [[ -n "${nginx_pid}" ]]; then
    kill -TERM "${nginx_pid}" 2>/dev/null || true
  fi
  if [[ -n "${server_pid}" ]]; then
    kill -TERM "${server_pid}" 2>/dev/null || true
  fi
}

trap terminate TERM INT

node /app/apps/server/dist/index.js &
server_pid=$!

nginx -g "daemon off;" &
nginx_pid=$!

set +e
wait -n "${server_pid}" "${nginx_pid}"
status=$?
set -e

terminate
wait "${server_pid}" 2>/dev/null || true
wait "${nginx_pid}" 2>/dev/null || true
exit "${status}"
