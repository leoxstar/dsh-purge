#!/bin/bash
# 同步上游：把 upstream/master 合并进 main（本 fork 自己的分支），再推回 fork。
#
#   ./scripts/sync-upstream.sh            # 同步并推送
#   ./scripts/sync-upstream.sh --dry-run  # 只看差多少，不动任何东西
#
# 分支模型（2026-10-19 起）：
#   · `main` 是本 fork 唯一的分支，**带本地补丁**（不是纯镜像）；
#   · 上游 YuJunZhiXue/dsh-purge 的默认分支叫 `master`（别人的仓库，改不了）；
#   · 所以两边名字不同，同步是 **merge**，不是 fast-forward。
#
# ⚠️ 因此 GitHub 的 **Sync fork** 按钮 / `gh repo sync` 都用不了：它们只做
# fast-forward，而 main 有本地提交必然分叉。同步只能走本脚本。
#
# 冲突只会出现在 #40 那一段附近（见 README.fork.md「改了什么」）。
# 想回退：脚本会打印同步前的 commit，`git reset --hard <commit>`。
set -euo pipefail

MIRROR="${MIRROR:-main}"       # 本 fork 的分支（带补丁）
UPSTREAM="${UPSTREAM:-master}" # 上游仓库自己的分支名，别改
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

cd "$(git rev-parse --show-toplevel)"

git fetch upstream --prune
git fetch origin --prune

echo "$MIRROR : $(git rev-parse --short "$MIRROR")"
echo "upstream/$UPSTREAM: $(git rev-parse --short "upstream/$UPSTREAM")"
echo "上游新提交: $(git rev-list --count "upstream/$UPSTREAM" --not "$MIRROR")  本分支独有: $(git rev-list --count "$MIRROR" --not "upstream/$UPSTREAM")"

if [ "$DRY" = "1" ]; then
  echo "--- 上游有、本分支没有的提交 ---"
  git log --oneline "upstream/$UPSTREAM" --not "$MIRROR" | head -10
  echo "--- 本分支有、上游没有的提交（就是我们的补丁）---"
  git log --oneline "$MIRROR" --not "upstream/$UPSTREAM" | head -10
  exit 0
fi

BEFORE="$(git rev-parse "$MIRROR")"
if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交改动，先提交或 stash 再来" >&2
  exit 1
fi

git checkout -q "$MIRROR"
if ! git merge --no-edit "upstream/$UPSTREAM"; then
  echo
  echo "合并冲突。解决后 git commit；想放弃：git merge --abort" >&2
  echo "同步前的 $MIRROR = $BEFORE" >&2
  exit 1
fi

if [ "$(git rev-parse "$MIRROR")" = "$BEFORE" ]; then
  echo "已是最新，没有要合并的上游提交"
  exit 0
fi

git push origin "$MIRROR"
echo "已同步: $MIRROR $(git rev-parse --short "$BEFORE") -> $(git rev-parse --short "$MIRROR")"
echo "回滚: git reset --hard $BEFORE   # 再 git push --force-with-lease origin $MIRROR"
