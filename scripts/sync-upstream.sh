#!/bin/bash
# 同步上游：master 快进到 upstream/master，再把修复分支 rebase 上去并推回 fork。
#
#   ./scripts/sync-upstream.sh            # 同步并推送
#   ./scripts/sync-upstream.sh --dry-run  # 只看差多少，不动任何东西
#
# 冲突只会出现在 #40 那一段附近（见 README.fork.md「改了什么」）。
# 想回退：脚本会打印同步前的 commit，`git reset --hard <commit>`。
set -euo pipefail

BRANCH="${BRANCH:-fix/dsh-0.2.1-compat}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

cd "$(git rev-parse --show-toplevel)"

git fetch upstream --prune
git fetch origin --prune

echo "master   : $(git rev-parse --short master)  →  upstream/master $(git rev-parse --short upstream/master)"
echo "$BRANCH: $(git rev-parse --short "$BRANCH")"
echo "落后上游的提交: $(git rev-list --count master..upstream/master)"

if [ "$DRY" = "1" ]; then
  git log --oneline master..upstream/master | head -10
  exit 0
fi

BEFORE="$(git rev-parse "$BRANCH")"
if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交改动，先提交或 stash 再来" >&2
  exit 1
fi

git checkout -q master
git merge --ff-only upstream/master
git push origin master

git checkout -q "$BRANCH"
if ! git rebase master; then
  echo
  echo "rebase 冲突。解决后 git rebase --continue；想放弃：git rebase --abort" >&2
  echo "同步前的 $BRANCH = $BEFORE" >&2
  exit 1
fi

echo "已同步: master=$(git rev-parse --short master)  $BRANCH $(git rev-parse --short "$BEFORE") -> $(git rev-parse --short "$BRANCH")"
git push --force-with-lease origin "$BRANCH"
echo "回滚: git reset --hard $BEFORE   # 再 git push --force-with-lease origin $BRANCH"
