#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
revision="$(git rev-parse --verify "${1:-HEAD}^{commit}")"
archive="$(mktemp "${TMPDIR:-/tmp}/darl-h3-archive.XXXXXXXX")"
trap 'rm -f "$archive"' EXIT
git archive --format=tar "$revision" > "$archive"

ssh -o BatchMode=yes -o ConnectTimeout=10 h3 'mkdir -p /workspace/.darl-deploy'
scp -q "$archive" "h3:/workspace/.darl-deploy/$revision.tar"
ssh -o BatchMode=yes -o ConnectTimeout=10 h3 bash -s -- "$revision" <<'REMOTE'
set -euo pipefail
revision="$1"
[[ "$revision" =~ ^[0-9a-f]{40,64}$ ]]
root=/workspace/darl-studio
deploy=/workspace/.darl-deploy
exec 9>"$deploy/deploy.lock"
flock 9
stage="$(mktemp -d "$deploy/stage.XXXXXXXX")"
stopped=0
cleanup() {
  if [ "$stopped" = 1 ]; then supervisorctl start darl-studio >/dev/null || true; fi
  rm -rf "$stage"
  rm -f "$deploy/$revision.tar"
}
trap cleanup EXIT
tar -xf "$deploy/$revision.tar" -C "$stage"
ln -s "$root/.env.local" "$stage/.env.local"
ln -s "$root/.local" "$stage/.local"
export PATH=/opt/nvm/versions/node/v24.22.1/bin:$PATH
cd "$stage"
npm ci --no-audit --no-fund
npm run build:agent-chat
supervisorctl stop darl-studio
stopped=1
rsync -a --exclude=/.local --exclude=/.env.local "$stage/" "$root/"
supervisorctl start darl-studio
stopped=0
curl -fsS --retry 10 --retry-delay 1 --retry-connrefused -o /dev/null http://127.0.0.1:21641/studio/
printf 'H3 已更新到 %s\n' "$revision"
REMOTE
