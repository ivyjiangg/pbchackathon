#!/usr/bin/env bash
set -euo pipefail
set +m

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/../.."
ROOT="$PWD"
TMP_DIR="$(mktemp -d)"
MOCK_PORT_FILE="$TMP_DIR/mock.port"

PROXY_PID=""
MOCK_PID=""

cleanup() {
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  [[ -n "$PROXY_PID" ]] && wait "$PROXY_PID" 2>/dev/null || true
  [[ -n "$MOCK_PID" ]] && kill "$MOCK_PID" 2>/dev/null || true
  [[ -n "$MOCK_PID" ]] && wait "$MOCK_PID" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "== Syntax check =="
node --check "$ROOT/packages/aegis-proxy/proxy.js"

echo "== Invalid AEGIS_SOLANA_NETWORK should exit 1 =="
set +e
AEGIS_SOLANA_NETWORK=not-a-network node "$ROOT/packages/aegis-proxy/proxy.js" 2>/dev/null
code=$?
set -e
if [[ "$code" -ne 1 ]]; then
  echo "FAIL: expected exit 1, got $code"
  exit 1
fi
echo "OK (exit 1)"

echo "== Local mock upstream (HTTP, no TLS) =="
export MOCK_PORT_FILE
node -e "
const http = require('http');
const fs = require('fs');
const p = process.env.MOCK_PORT_FILE;
const s = http.createServer((q, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('smoke-ok');
});
s.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(p, String(s.address().port));
});
" &
MOCK_PID=$!
sleep 0.4
MOCK_PORT="$(cat "$MOCK_PORT_FILE")"

PORT=$((18080 + RANDOM % 2000))
export PORT
echo "== Start proxy on PORT=$PORT (mock upstream :$MOCK_PORT) =="
node "$ROOT/packages/aegis-proxy/proxy.js" &
PROXY_PID=$!
sleep 1

echo "== GET / without target -> 400 =="
code=$(curl -s -o "$TMP_DIR/body1.txt" -w "%{http_code}" "http://127.0.0.1:$PORT/")
if [[ "$code" != "400" ]]; then echo "FAIL status $code body:"; cat "$TMP_DIR/body1.txt"; exit 1; fi
grep -q "Missing target" "$TMP_DIR/body1.txt" || { echo "FAIL body"; cat "$TMP_DIR/body1.txt"; exit 1; }
echo "OK"

echo "== Whitelisted http://127.0.0.1:$MOCK_PORT -> forward 200 =="
code=$(curl -s -o "$TMP_DIR/body2.txt" -w "%{http_code}" -H "x-aegis-target: http://127.0.0.1:$MOCK_PORT/" "http://127.0.0.1:$PORT/")
if [[ "$code" != "200" ]]; then echo "FAIL status $code"; cat "$TMP_DIR/body2.txt"; exit 1; fi
grep -q "smoke-ok" "$TMP_DIR/body2.txt" || { echo "FAIL body"; cat "$TMP_DIR/body2.txt"; exit 1; }
echo "OK"

echo "== Non-whitelisted host -> 403 =="
code=$(curl -s -o "$TMP_DIR/body3.txt" -w "%{http_code}" -H "x-aegis-target: https://evil.test/" "http://127.0.0.1:$PORT/")
if [[ "$code" != "403" ]]; then echo "FAIL status $code"; cat "$TMP_DIR/body3.txt"; exit 1; fi
echo "OK"

kill "$PROXY_PID" 2>/dev/null || true
wait "$PROXY_PID" 2>/dev/null || true
PROXY_PID=""

kill "$MOCK_PID" 2>/dev/null || true
wait "$MOCK_PID" 2>/dev/null || true
MOCK_PID=""

echo "== Custom AEGIS_SOLANA_RPC_URL (startup) =="
export AEGIS_SOLANA_RPC_URL="https://api.devnet.solana.com"
node "$ROOT/packages/aegis-proxy/proxy.js" &
PROXY_PID=$!
sleep 1
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/")
if [[ "$code" != "400" ]]; then echo "FAIL second server status $code"; exit 1; fi
kill "$PROXY_PID" 2>/dev/null || true
wait "$PROXY_PID" 2>/dev/null || true
PROXY_PID=""

trap - EXIT
cleanup

echo "All smoke tests passed."
