#!/usr/bin/env bash
# 构建并通过 preview 端口对外提供打包后的 Agent Chat（配合 Cloudflare Tunnel 使用）。
# 开发时用 `npm run dev:agent-chat`（热更新，但首屏要逐个拉取未打包模块，隧道下很慢）。
set -euo pipefail
cd "$(dirname "$0")/.."
# 固定使用可用的 node（Homebrew 默认 node 可能缺动态库），避免 launchd 环境里 dyld 失败。
NODE_BIN="${AGENT_CHAT_NODE_BIN:-/opt/homebrew/Cellar/node@24/24.22.0/bin}"
export PATH="$NODE_BIN:$PATH"

PORT="${AGENT_CHAT_PREVIEW_PORT:-5199}"
PUBLIC_HOST="${AGENT_CHAT_PUBLIC_HOST:-agents.darlai.cn}"
NOTIFY="${AGENT_CHAT_NOTIFY:-1}"

# macOS 通知；AGENT_CHAT_NOTIFY=0 可关闭。osascript 失败只记日志，不影响服务启动。
notify() {
  local title="$1" message="$2" sound="$3"
  [ "$NOTIFY" = "0" ] && return 0
  command -v osascript >/dev/null 2>&1 || return 0
  local escaped="${message//\"/\\\"}"
  if osascript -e "display notification \"${escaped}\" with title \"${title}\" sound name \"${sound}\"" >/dev/null 2>&1; then
    echo "[preview] 通知已发送：$title"
  else
    echo "[preview] 通知发送失败（不影响服务）：$title" >&2
  fi
}

notify "Agent Chat" "开始构建…" "Tink"

if ! npm run build:agent-chat; then
  notify "Agent Chat 构建失败" "旧版本仍在运行，请查看日志" "Basso"
  exit 1
fi

# 先起服务，等端口真正可用后再通知，避免“构建完成”但页面还打不开。
"$NODE_BIN/node" node_modules/vite/bin/vite.js preview --config vite.agent-chat.config.ts &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

ready=""
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    notify "Agent Chat 启动失败" "预览服务已退出，请查看日志" "Basso"
    exit 1
  fi
  if curl -fsS -m 2 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.3
done

if [ -n "$ready" ]; then
  notify "Agent Chat 已更新" "$(git rev-parse --short HEAD 2>/dev/null || echo preview) · https://$PUBLIC_HOST" "Glass"
fi

wait "$SERVER_PID"
