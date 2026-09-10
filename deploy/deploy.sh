#!/usr/bin/env bash
# 在服务器上执行：git pull 后一键更新
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/.env ] || { echo "缺少 deploy/.env，先 cp deploy/.env.example deploy/.env 并填写"; exit 1; }
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml up -d --build --remove-orphans
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml ps
echo "→ https://baccarat.yytbank.cn"
