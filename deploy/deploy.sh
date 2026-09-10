#!/usr/bin/env bash
# 在服务器上执行：git pull 后一键更新
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/.env ] || { echo "缺少 deploy/.env，先 cp deploy/.env.example deploy/.env 并填写"; exit 1; }
# FRONT=caddy    ：本机 80/443 空闲，用自带 Caddy 自动 HTTPS
# FRONT=external ：80/443 已被别的项目占用，由已有的 Nginx/Caddy 转发到 127.0.0.1:18080（见 nginx-baccarat.conf）
FRONT=${FRONT:-$(grep -E '^FRONT=' deploy/.env | cut -d= -f2)}
FRONT=${FRONT:-caddy}
PROFILE=(); [ "$FRONT" = "caddy" ] && PROFILE=(--profile caddy)
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml "${PROFILE[@]}" up -d --build --remove-orphans
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml "${PROFILE[@]}" ps
[ "$FRONT" = "external" ] && echo "→ 服务端在 127.0.0.1:18080，SRS 信令 127.0.0.1:11985；请确认已有反向代理已配置 deploy/nginx-baccarat.conf" 
echo "→ https://baccarat.yytbank.cn"
