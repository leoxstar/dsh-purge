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
| `package.json` | `version` → `1.1.72-fork.2`；`dshTarget` → `0.2.1-rc.2`；`npm test` 跑两个自测 |
| `lib/identity.js` | `CWD_ONLY_SUFFIX` 清空；`isCwdOnlyText()` 改为按形状识别（含变量形态 + 目录词）；`stripHarnessPersona()` 不再回写 `{{cwd}}`；`overlayOfficialIdentity()` 的前缀分支也走 cwd-only 判定 |
| `lib/core.js`（第二处） | 删掉从未被引用的 `ALLOW_EXEC_PERSONA_BLOCK` / `ALLOW_EXEC_PERSONA_LINE`（它们把 `{{cwd}}` 拼在执行句前，日后接回会直接炸装配） |
| `scripts/self-test-cwd-variable.mjs` | 新增自测：拿宿主自己的 `renderPrompt` 当判据，证伪旧文本、验证新产物 |

### 第二个补丁：`{{cwd}}` 让每次新会话装配失败

上游 0.2.1 删掉了 `cwd` 提示词变量（工作目录改由 working-directory 服务的
required runtime context 提供），而 0.2.1 的 `renderPrompt` 对未注册变量是**抛错**：

```text
unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
registered variables: provider, model
```

本 fork 的 `lib/identity.js` 抄的是 0.2.0 那版常量（`"Your working directory is {{cwd}}."`），
所以装配在 persona-suffix 这一步就死了；上游同一个文件里那段解释性注释本 fork 没跟过来。
宿主自己的 `dsh-system-prompt/README.md` 在「Contribute a prompt variable」里也明说：
自定义 persona 不能依赖 `{{cwd}}`，要把它从 `personaSuffix` / preset `suffix` 里删掉。

修法（与上游一致）：常量清空，工作目录交给 runtime context；同时把判定从
「只认两个字面量」放宽到「含未注册变量形态 + 目录词」，`stripHarnessPersona()`
的两条替换也不再回写 `{{cwd}}`（否则剥完身份反而多出一个会抛错的变量）。


替换后的 `sections` 语义，和 #40 原有的「已折进 persona」分支一致：

- complete 段里已经有注入文本 → 原样返回，不重复拼；
- 没有 → 把 `dsh-purge` 各段的文本按 `\n\n` 拼在 complete 段最前面；
- 注入为空 → 返回原 complete 段（与改动前等价）。

产物同时写入两个标记：`[dsh-purge] complete prompt keeps inject`（宿主清洁判据要认）
与 `fold-complete inject first`（#40 自己的 markers）。

## 自测

```sh
npm test        # 两个自测都跑
# 或分开跑：
node scripts/self-test-complete-inject.mjs
node scripts/self-test-cwd-variable.mjs
```

判据不是装饰，跑之前先看这几条会失败：

- **反例**：未打补丁的 0.2.1 文本，`hostPromptKeepsInject()` 必须是 `false`。若它变成
  `true`，说明判据恒真，整个自测失去意义；
- **正对照**：同一份文本打完补丁后必须是 `true`；
- **幂等**：再打一次 `changed === false`；
- **回归**：0.1.5 形态仍能匹配；
- **语法**：补丁产物过 `node --check`；
- **行为**：complete 模式注入回到最前；已含注入时不重复拼；`contexts` 过滤仍生效。

`self-test-cwd-variable.mjs` 的判据取自**宿主自己的渲染器**（只读
`Resources/app/.../dsh-system-prompt/lib/index.js` 里的 `renderPrompt`），所以不是
「看代码像对」：

- **正对照**：旧的 `"Your working directory is {{cwd}}."` 喂进去必须抛出那条真机错误
  （字符串与真机逐字一致，含 `registered variables: provider, model`）—— 这条要是变绿，
  说明夹具或渲染器不对，别的判据都不能信；
- **修好**：`rewritePromptAssembly()` 的产物过同一台渲染器必须不抛错；
- **兜底**：产物里不得残留任何 `{{…}}` 形态（不止 `cwd`）；
- **回归**：旧文本经插件后也必须干净，而不是靠「换个来源」绕过去。


## 安装（本机）

```sh
./scripts/install-local.sh                 # 默认 ~/.dsh/profiles/desktop
./scripts/install-local.sh ~/.dsh/profiles/web
```

脚本只做两件事：把原 `node_modules/dsh-purge` 改名备份，再把本仓库软链过去。
**不跑包管理器**——profile 里若重新 `pnpm install`，会把软链换成从 GitHub 拉下来的
tarball 副本（`package.json` 指向本 fork 的 `main`，所以拉下来的是**带补丁的**，不是上游），
装完再跑一次本脚本即可回到软链。

> 只想对齐 `pnpm-lock.yaml` 而不碰 `node_modules` 时用：
> `pnpm install --lockfile-only`（实测不会动软链，只重算锁文件与 integrity）。

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

分支模型（2026-10-19 定）：

- `main`：本 fork **唯一**的分支，**带本地补丁**（不是纯镜像）。默认分支就是它；
- 上游 `master`：不落本地分支，只用 `upstream/master` 这个远端跟踪引用做合并基底。

> **上游叫 `master`，本 fork 叫 `main`**。上游是别人的仓库，改不了；本 fork 的默认分支
> 2026-10-19 从 `master` 改名为 `main`，远端 `master` 已删除（`origin/master` 也 prune 了）。
> 所以脚本里两边各用一个名字：本地 `main` / 上游 `upstream/master`，
> 顶部两个变量 `MIRROR` / `UPSTREAM` 可覆盖。
>
> ⚠️ 代价说清楚：`main` 有本地提交，跟上游必然分叉，所以 **GitHub 的 Sync fork 按钮和
> `gh repo sync` 都不能用了** —— 它们只做 fast-forward。同步只能跑本仓的脚本（走 merge）。
>
> ⚠️ `package.json` 与 `README.md` / `README.en.md` / `README.zh-CN.md` 里那些
> `refs/heads/master.tar.gz` 链接指的是**上游**，不要跟着改成 `main` —— 上游没有 main，
> 改了就是死链。

同步上游：

```sh
./scripts/sync-upstream.sh --dry-run   # 看上游有多少新提交、本地独有哪些
./scripts/sync-upstream.sh             # 把 upstream/master 合并进 main 并推回 fork
```

脚本做的事：`git fetch upstream` → `main` merge `upstream/master`（`--no-edit`）→
`git push origin main`。**不 rebase、不 force push**，所以历史只增不改。
冲突只会出现在 #40 那一段附近；放弃用 `git merge --abort`，回退用脚本打印的旧 commit。

装回 profile 的始终是本地工作区（软链），所以同步完**不需要重新安装**：重启宿主后生效。

## 验证是否真的修好

重启后：

1. `curl -s http://127.0.0.1:<GUI 端口>/dsh-purge/status` 应返回 `ok: true`；
2. 面板点「应用」，回包里 `complete` 应为 `true`（不再是「CMD 无感未钉入（unknown）」）；
3. `hostPromptKeepsInject()` 对 `Resources/app/.../dsh-system-prompt/lib/index.js` 返回
   `true`（`node scripts/self-test-complete-inject.mjs` 末尾会打印真机只读自检）；
4. `/dsh-purge/restart` 不再返回「清洗没有写进全部宿主」，密封包换包这条路恢复可用；
5. 开一个新会话，不再出现 `unknown prompt variable "{{cwd}}" in section
   "deployment:persona-suffix"`（`npm test` 里第二条自测就是这条的离线判据）。

## 不做的事

- 不改包名 `dsh-purge`（profile 的 bundle 列表按名字引用）。
- 不改提示词内容、不改演练台、不新增任何能力。
- 不追上游新版本；要跟时 `git fetch upstream && git merge upstream/master`（或在 `main`
  上跑 `./scripts/sync-upstream.sh`），冲突只会在 #40 这一段附近。
