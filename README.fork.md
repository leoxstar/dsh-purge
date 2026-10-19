# dsh-purge（本地 fork）

上游：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（MIT）。
本仓库是它的本地 fork，只做 **dsh 0.2.1 兼容修正**，不改变用途、不新增能力。

> 上游的署名要求照旧：借用其名称、思路、代码或提示词必须署名并标明来源仓库。
> 本 fork 的每一处改动都在下面写明「改了什么 / 为什么」，没有隐藏来源。

## 为什么 fork

上游 `dshTarget` 只写到 `0.2.0-rc.2`。本机跑的是 **0.2.1-rc.2**，于是：

1. `dsh-system-prompt/lib/index.js` 里的 `assemble` 在 `return` 前多了一行
   `const requiredContexts = new Set(...)`，`contexts` 也从 `[] : transformed.contexts`
   变成带过滤的写法；
2. patch **#40**（`COMPLETE_PROMPT_KEEP_INJECT`，层标记 `0.1.5 兼容`）的 8 个 pattern
   全部对不上 → 状态记为 `skipped`；
3. 但宿主清洁判据 `hostPromptKeepsInject()` 仍然要求文件里不能出现
   `transformed.sections : [completeSection]` → 该判据在 0.2.1 上**恒假**；
4. 后果连锁：`/dsh-purge/apply` 的 `complete` 恒为 `false` →
   - 面板显示「提示词已写入。CMD 无感未钉入（unknown）」（`unknown` 是兜底占位，因为
     `failed=0` 且 `cmd_flash.ok=true`，没有任何具体原因可报）；
   - `/dsh-purge/restart` 返回「清洗没有写进全部宿主，已取消重启」→
     **密封包（app.asar）永远不换**，补丁只写在 `Resources/app/`，运行进程读不到。

上游作者在 #40 的注释里已经写过同类坑（「0.2 有的构建用 tab，有的用空格；只认 tab 时
匹配为 0，重启校验会说没写进宿主」），只是没覆盖 0.2.1 这一次写法变化。

## 改了什么

| 文件 | 改动 |
|---|---|
| `lib/core.js` | 新增常量 `COMPLETE_PROMPT_SECTIONS_021`；给 #40 增加一个 **行级** replacement：只替换 `sections: completeSection === void 0 ? transformed.sections : [completeSection],` 这一行，`requiredContexts` 与 `contexts` 保持原样 |
| `scripts/self-test-complete-inject.mjs` | 新增自测：正对照 + 反例 + 0.1.5 回归 + `node --check` + 行为验证 |
| `scripts/install-local.sh` | 把本 fork 指到某个 DSH profile 的 `node_modules/dsh-purge`（备份原副本，可回滚） |
| `package.json` | `version` → `1.1.72-fork.1`；`dshTarget` → `0.2.1-rc.2`；新增 `npm test` |

替换后的 `sections` 语义，和 #40 原有的「已折进 persona」分支一致：

- complete 段里已经有注入文本 → 原样返回，不重复拼；
- 没有 → 把 `dsh-purge` 各段的文本按 `\n\n` 拼在 complete 段最前面；
- 注入为空 → 返回原 complete 段（与改动前等价）。

产物同时写入两个标记：`[dsh-purge] complete prompt keeps inject`（宿主清洁判据要认）
与 `fold-complete inject first`（#40 自己的 markers）。

## 自测

```sh
node scripts/self-test-complete-inject.mjs
```

判据不是装饰，跑之前先看这几条会失败：

- **反例**：未打补丁的 0.2.1 文本，`hostPromptKeepsInject()` 必须是 `false`。若它变成
  `true`，说明判据恒真，整个自测失去意义；
- **正对照**：同一份文本打完补丁后必须是 `true`；
- **幂等**：再打一次 `changed === false`；
- **回归**：0.1.5 形态仍能匹配；
- **语法**：补丁产物过 `node --check`；
- **行为**：complete 模式注入回到最前；已含注入时不重复拼；`contexts` 过滤仍生效。

## 安装（本机）

```sh
./scripts/install-local.sh                 # 默认 ~/.dsh/profiles/desktop
./scripts/install-local.sh ~/.dsh/profiles/web
```

脚本只做两件事：把原 `node_modules/dsh-purge` 改名备份，再把本仓库软链过去。
**不跑包管理器**——profile 里若重新 `pnpm install`，会因为 `package.json` 仍指向上游
tarball 而把软链覆盖掉，装完再跑一次本脚本即可。

安装后必须重启宿主（退出 DeepSeek Harness 再打开），插件才重新加载。

回滚：

```sh
rm ~/.dsh/profiles/desktop/node_modules/dsh-purge
mv ~/.dsh/profiles/desktop/node_modules/dsh-purge.upstream-<时间戳> \
   ~/.dsh/profiles/desktop/node_modules/dsh-purge
```

## 远端布局与同步上游

这是 GitHub 上真正的 fork：**[leoxstar/dsh-purge](https://github.com/leoxstar/dsh-purge)**，
parent 是上游 `YuJunZhiXue/dsh-purge`（`gh repo view --json isFork,parent` 可验证）。

| 远端 | 指向 | 用途 |
|---|---|---|
| `origin` | `leoxstar/dsh-purge` | 自己的 fork，日常推这里 |
| `upstream` | `YuJunZhiXue/dsh-purge` | 上游，只 fetch，不 push |

分支分工（**别把补丁放到 master**，否则 fork 同步就会冲突）：

- `master`：上游镜像，永远 fast-forward，不落任何本地提交；
- `fix/dsh-0.2.1-compat`：本 fork 的唯一改动，一个 commit。

同步上游：

```sh
./scripts/sync-upstream.sh --dry-run   # 先看落后多少、上游有哪些新提交
./scripts/sync-upstream.sh             # master 快进 + 修复分支 rebase + 推回 fork
```

脚本做的事：`git fetch upstream` → `master` fast-forward 到 `upstream/master` 并推送 →
`fix/dsh-0.2.1-compat` rebase 到新 master → `push --force-with-lease`。
冲突只会出现在 #40 那一段附近；放弃用 `git rebase --abort`，回退用脚本打印的旧 commit。

也可以在 GitHub 页面上点 **Sync fork** / `gh repo sync leoxstar/dsh-purge`
——那只同步 `master`（默认分支），修复分支仍需上面的 rebase。

装回 profile 的始终是本地工作区（软链），所以同步完**不需要重新安装**：切到
`fix/dsh-0.2.1-compat` 分支即可，重启宿主后生效。

## 验证是否真的修好

重启后：

1. `curl -s http://127.0.0.1:<GUI 端口>/dsh-purge/status` 应返回 `ok: true`；
2. 面板点「应用」，回包里 `complete` 应为 `true`（不再是「CMD 无感未钉入（unknown）」）；
3. `hostPromptKeepsInject()` 对 `Resources/app/.../dsh-system-prompt/lib/index.js` 返回
   `true`（`node scripts/self-test-complete-inject.mjs` 末尾会打印真机只读自检）；
4. 此后 `/dsh-purge/restart` 不再返回「清洗没有写进全部宿主」，密封包换包这条路恢复可用。

## 不做的事

- 不改包名 `dsh-purge`（profile 的 bundle 列表按名字引用）。
- 不改提示词内容、不改演练台、不新增任何能力。
- 不追上游新版本；要跟时 `git fetch upstream && git rebase upstream/master`，冲突只会在
  #40 这一段附近。
