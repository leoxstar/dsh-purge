#!/bin/bash
# 把本 fork 指到某个 DSH profile 的 node_modules/dsh-purge（软链，不跑包管理器）。
# 用法: ./scripts/install-local.sh [profile 目录]   默认 ~/.dsh/profiles/desktop
set -euo pipefail

PROFILE="${1:-$HOME/.dsh/profiles/desktop}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$PROFILE/node_modules/dsh-purge"

[ -d "$PROFILE" ] || { echo "没有这个 profile: $PROFILE"; exit 1; }
[ -d "$PROFILE/node_modules" ] || { echo "profile 里没有 node_modules: $PROFILE"; exit 1; }
[ -f "$REPO/lib/index.js" ] || { echo "仓库不完整（缺 lib/index.js）: $REPO"; exit 1; }

if [ -L "$TARGET" ]; then
  echo "已经是指向 $(readlink "$TARGET") 的软链，重建一次"
  rm -f "$TARGET"
elif [ -d "$TARGET" ]; then
  BAK="$TARGET.upstream-$(date +%Y%m%d%H%M%S)"
  mv "$TARGET" "$BAK"
  echo "原副本已备份: $BAK"
else
  echo "原来没有 dsh-purge，直接建立软链"
fi

ln -sfn "$REPO" "$TARGET"
echo "已指向 fork: $TARGET -> $(readlink "$TARGET")"
echo
echo "下一步：完全退出 DeepSeek Harness 再打开，然后 dsh-purge → 清洗 → 应用。"
echo "回滚：rm \"$TARGET\" 并把上面那个 .upstream-<时间戳> 目录改回 dsh-purge。"
