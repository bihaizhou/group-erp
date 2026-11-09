#!/usr/bin/env bash
# 合并即上线：master 有新的提交且 CI 通过后，自动构建并部署到 13010。
#
#   ./deploy.sh              # 正常：有变更才部署
#   ./deploy.sh --force      # 忽略 sha 比对和 CI，直接部署当前 master
#   ./deploy.sh --dry-run    # 构建+打包+建镜像，但不备份库、不切流量、不重启
#
# 任何一步失败都不会切换线上版本；切换后健康检查不过会自动回滚上一版。
set -Eeuo pipefail

ROOT=/home/qwkj/group-erp
SRC=$ROOT/src
DEPLOY=$ROOT/deploy
RELEASES=$ROOT/releases
BACKUPS=$DEPLOY/backups
COMPOSE=$DEPLOY/compose.yml
STATE=$DEPLOY/.deployed-sha
LOG=$ROOT/deploy.log
OWNER_REPO=bihaizhou/group-erp
HEALTH=http://192.168.5.189:13010/main/api/healthz
APP_CONTAINER=group-erp-app-1
DB_CONTAINER=group-erp-db-1
KEEP_RELEASES=5

export PATH=/opt/node24/bin:/home/qwkj/.local/bin:/usr/local/bin:/usr/bin:/bin

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; printf '%s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

MODE=${1:-}

# 同一时间只跑一个部署
exec 9>/tmp/group-erp-deploy.lock
flock -n 9 || { log "另一个部署正在进行，跳过"; exit 0; }

timeout 180 git -C "$SRC" fetch -q origin master || die "拉取 origin/master 失败（网络？）"
SHA=$(git -C "$SRC" rev-parse origin/master)
PREV=$(cat "$STATE" 2>/dev/null || true)

if [ "$MODE" != "--force" ] && [ "$SHA" = "$PREV" ]; then
  exit 0                     # 没有新提交，安静退出（cron 每 2 分钟跑一次）
fi

log "================ deploy ${PREV:-（首次）} -> $SHA ================"

# 1) 等 CI 通过，避免把红代码送上生产
if [ "$MODE" = "" ]; then
  deadline=$(( $(date +%s) + 1800 ))
  while :; do
    verdict=$(curl -fsS "https://api.github.com/repos/$OWNER_REPO/actions/runs?head_sha=$SHA&per_page=20" 2>/dev/null |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=(JSON.parse(s).workflow_runs||[]);if(!r.length)return console.log("none");if(r.some(x=>x.status!=="completed"))return console.log("pending");if(r.some(x=>x.conclusion!=="success"))return console.log("failed");console.log("ok")}catch(e){console.log("none")}})')
    case "$verdict" in
      ok) break ;;
      failed) die "CI 未通过（$SHA），不部署" ;;
      *) [ "$(date +%s)" -gt "$deadline" ] && die "等待 CI 超时（$SHA）"; sleep 20 ;;
    esac
  done
fi

# 2) 检出并构建
git -C "$SRC" checkout -q --force "$SHA"
git -C "$SRC" clean -qfd
cd "$SRC"
log "安装依赖…"
pnpm install --frozen-lockfile --ignore-scripts >/dev/null
log "构建…"
pnpm build --tar --target linux-x64 --node-version 24 >/dev/null
ART=$SRC/storage/exports/dist.tar.gz
[ -f "$ART" ] || die "构建产物缺失：$ART"

# 3) 打包成 release 目录
TAG=erp-$(date +%Y%m%d-%H%M)
R=$RELEASES/$TAG
mkdir -p "$R"
cp "$ART" "$R/dist.tar.gz"
cp "$SRC/deploy/Dockerfile.prebuilt" "$R/Dockerfile.prebuilt"
cp "$SRC/deploy/config.example.yml" "$R/config.example.yml" 2>/dev/null || true
tar -xzf "$R/dist.tar.gz" -C "$R"
log "构建镜像 group-erp:$TAG"
docker build -q -t "group-erp:$TAG" -f "$R/Dockerfile.prebuilt" "$R" >/dev/null

if [ "$MODE" = "--dry-run" ]; then
  log "dry-run 完成：$R 与镜像 group-erp:$TAG 已就绪，未改动线上"
  exit 0
fi

# 4) 备份数据库与 compose
mkdir -p "$BACKUPS"
log "备份数据库…"
docker exec "$DB_CONTAINER" pg_dump -U group_erp group_erp | gzip >"$BACKUPS/db-$TAG.sql.gz"
cp "$COMPOSE" "$DEPLOY/compose.yml.before-$TAG"

# 5) 切镜像并重启 app
OLD_IMAGE=$(sed -n 's/^    image: \(group-erp:.*\)$/\1/p' "$COMPOSE" | head -1)
sed -i "s|^    image: group-erp:.*$|    image: group-erp:$TAG|" "$COMPOSE"
( cd "$DEPLOY" && docker compose up -d --no-deps app >/dev/null )

# 6) 健康检查，不通过就回滚
code=000
for _ in $(seq 1 80); do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH" || echo 000)
  [ "$code" = "200" ] && break
  sleep 3
done

if [ "$code" != "200" ]; then
  log "健康检查失败（$code），回滚到 $OLD_IMAGE"
  cp "$DEPLOY/compose.yml.before-$TAG" "$COMPOSE"
  ( cd "$DEPLOY" && docker compose up -d --no-deps app >/dev/null ) || true
  die "部署失败，已回滚"
fi

# 7) 记录并清理旧版本
echo "$SHA" >"$STATE"
cat >"$R/release.json" <<JSON
{
  "release": "$TAG",
  "sha": "$SHA",
  "deployedAt": "$(date -Is)",
  "image": "group-erp:$TAG",
  "previousImage": "$OLD_IMAGE",
  "composeBackup": "deploy/compose.yml.before-$TAG",
  "changes": "$(git -C "$SRC" log -1 --pretty=%s | sed 's/"/\\"/g')"
}
JSON
log "部署成功：$TAG（$SHA）"

ls -1d "$RELEASES"/erp-* 2>/dev/null | sort | head -n -"$KEEP_RELEASES" | while read -r old; do
  log "清理旧 release $(basename "$old")"
  docker rmi "group-erp:$(basename "$old")" >/dev/null 2>&1 || true
  rm -rf "$old"
done
