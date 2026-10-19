#!/bin/bash
# 同步上游：main 快进到 upstream/master，再把修复分支 rebase 上去并推回 fork。
#
#   ./scripts/sync-upstream.sh            # 同步并推送
#   ./scripts/sync-upstream.sh --dry-run  # 只看差多少，不动任何东西
#
# 冲突只会出现在 #40 那一段附近（见 README.fork.md「改了什么」）。
# 想回退：脚本会打印同步前的 commit，`git reset --hard <commit>`。
#
# 分支名注意：**上游用 `master`，本 fork 用 `main`**。这不是笔误 ——
# 上游 YuJunZhiXue/dsh-purge 的默认分支叫 master，改不了（别人的仓库）；
# 本 fork 的镜像分支从 2026-10-19 起叫 main，`origin/master` 已删除。
# 所以脚本里两边各用一个名字：本地 `main` 跟踪 `origin/main`，
# 快进时从 `upstream/master` 取。
set -euo pipefail

BRANCH="${BRANCH:-fix/dsh-0.2.1-compat}"
MIRROR="${MIRROR:-main}"      # 本 fork 的镜像分支（= 上游 master 的内容）
UPSTREAM="${UPSTREAM:-master}" # 上游仓库自己的分支名，别改
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

cd "$(git rev-parse --show-toplevel)"

git fetch upstream --prune
git fetch origin --prune

echo "$MIRROR   : $(git rev-parse --short "$MIRROR")  →  upstream/$UPSTREAM $(git rev-parse --short "upstream/$UPSTREAM")"
echo "$BRANCH: $(git rev-parse --short "$BRANCH")"
echo "落后上游的提交: $(git rev-list --count "$MIRROR..upstream/$UPSTREAM")"

if [ "$DRY" = "1" ]; then
  git log --oneline "$MIRROR..upstream/$UPSTREAM" | head -10
  exit 0
fi

BEFORE="$(git rev-parse "$BRANCH")"
if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交改动，先提交或 stash 再来" >&2
  exit 1
fi

git checkout -q "$MIRROR"
git merge --ff-only "upstream/$UPSTREAM"
git push origin "$MIRROR"

git checkout -q "$BRANCH"
if ! git rebase "$MIRROR"; then
  echo
  echo "rebase 冲突。解决后 git rebase --continue；想放弃：git rebase --abort" >&2
  echo "同步前的 $BRANCH = $BEFORE" >&2
  exit 1
fi

echo "已同步: $MIRROR=$(git rev-parse --short "$MIRROR")  $BRANCH $(git rev-parse --short "$BEFORE") -> $(git rev-parse --short "$BRANCH")"
git push --force-with-lease origin "$BRANCH"
echo "回滚: git reset --hard $BEFORE   # 再 git push --force-with-lease origin $BRANCH"
