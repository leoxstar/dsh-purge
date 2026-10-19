#!/usr/bin/env node
/**
 * 红队模式预设自测（dsh 0.2.1）。
 *
 * 守的是 2026-10-19 那次事故：预设里写了 0.2.1 已删掉的
 * `tool-subagent.config.toolFilter`，宿主 apply 时直接抛
 *   "tool-subagent: toolFilter is no longer supported ..."
 * 整个「红队模式」记成 registered-broken，56 个 redteam_* 工具一个都挂不上。
 *
 * 判据（每条都必须能失败）：
 *   1. 任何 tool-subagent 块里都不许出现 toolFilter / persona 键（0.2.1 会 throw）；
 *   2. spawn 的那块必须 maxDepth: 1（叶子约束）；
 *   3. 每条插件行的 name 都能解析到真实包/文件（!!js 判为 disabled 的行只记录）；
 *   4. tools.js 用桩 ctx 能注册出 56 个 redteam_*；
 *   5. store.js 能在临时目录建库、openEngagement/stats 正常；
 *   6. 仓库模板与已安装副本的 tool-subagent 块一致（防止插件装回旧副本）。
 *
 * 为什么按行扫而不是用 preset-composition 的解析结果：那个 reader 是给
 * registry.register 用的，cordis:group 的子行落在 config 里，按它审计会漏。
 *
 * 用法: node scripts/self-test-redteam-preset.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const TEMPLATE = path.join(REPO, "presets", "redteam", "agent.cordis.yml");
const INSTALLED = path.join(os.homedir(), ".dsh", ".agent-presets", "redteam", "agent.cordis.yml");

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed += 1;
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
}

const AI_BASE = [
  process.env.DSH_AI_BASE,
  "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai",
  path.join(os.homedir(), ".npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"),
].filter(Boolean).find((p) => fs.existsSync(p)) || "";

const REPO_PKG = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const EXPORTS = Object.keys(REPO_PKG.exports || {});

/** 把顶层/嵌套的 `- id:` 块切出来（按缩进判定归属）。 */
function splitBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = /^(\s*)-\s+id:\s*'?([A-Za-z0-9._-]+)'?\s*$/.exec(line);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { id: m[2], indent: m[1].length, lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

/** `disabled:` 可能是 true/false、也可能是 !!js 表达式；只按平台判断求值。 */
function isDisabled(block) {
  const line = block.lines.find((l) => /^\s+disabled:\s*\S/.test(l));
  if (!line) return false;
  const raw = line.split("disabled:")[1].trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  const js = /\{\s*__jsExpr:\s*["']?(.+?)["']?\s*\}/.exec(line);
  const expr = js ? js[1] : "";
  const eq = /^process\.platform\s*===\s*'([a-z0-9]+)'$/.exec(expr);
  if (eq) return process.platform === eq[1];
  const ne = /^process\.platform\s*!==\s*'([a-z0-9]+)'$/.exec(expr);
  if (ne) return process.platform !== ne[1];
  return false; // 认不出的表达式按启用算，宁可多查
}

function nameOf(block) {
  const line = block.lines.find((l) => /^\s+name:\s*/.test(l));
  if (!line) return "";
  return line.split("name:")[1].trim().replace(/^['"]|['"]$/g, "");
}

function resolveName(name) {
  if (!name) return { ok: false, why: "缺 name" };
  if (name.startsWith("file://")) return { ok: fs.existsSync(new URL(name)), why: "file URL" };
  if (name.startsWith("./")) return { ok: fs.existsSync(path.join(path.dirname(TEMPLATE), name.slice(2))), why: "相对文件" };
  if (name.startsWith("dsh-purge/")) return { ok: EXPORTS.includes("./" + name.slice("dsh-purge/".length)), why: "包内子路径" };
  if (name.startsWith("cordis:")) return { ok: true, why: "cordis 内置" };
  if (!AI_BASE) return { ok: true, why: "宿主目录未知，跳过" };
  const base = AI_BASE.endsWith("@deepseek-ai") ? path.dirname(AI_BASE) : AI_BASE;
  return { ok: fs.existsSync(path.join(base, name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/"))), why: "宿主包" };
}

/** 纯文本审计：返回判据结果，不打印（供 audit 与 --self-test 共用）。 */
function inspect(text) {
  const blocks = splitBlocks(text);
  const subBlocks = blocks.filter((b) => b.id === "tool-subagent");
  const bannedHits = [];
  for (const b of subBlocks) {
    for (const line of b.lines) {
      if (/^\s+(toolFilter|persona)\s*:$/.test(line)) bannedHits.push(`${b.id}:${line.trim()}`);
    }
  }
  const spawn = subBlocks.find((b) => /^\s+provider:\s*spawn\s*$/m.test(b.lines.join("\n"))) || subBlocks[0];
  const maxDepth = spawn ? (/^\s+maxDepth:\s*(\S+)\s*$/m.exec(spawn.lines.join("\n")) || [])[1] : "";
  const unresolved = [];
  const skipped = [];
  for (const b of blocks) {
    const name = nameOf(b);
    const r = resolveName(name);
    if (r.ok) continue;
    if (isDisabled(b)) skipped.push(`${b.id}(disabled)`);
    else unresolved.push(`${b.id}:${name} (${r.why})`);
  }
  const semantic = subBlocks.map((b) => b.lines
    .filter((l) => /^\s+[A-Za-z][A-Za-z0-9]*:\s*\S/.test(l) && !/^\s*#/.test(l))
    .map((l) => l.trim()).sort().join("|")).join("---");
  return { blocks, subBlocks, bannedHits, maxDepth, unresolved, skipped, semantic };
}

function audit(label, file) {
  console.log(`\n— ${label}: ${file}`);
  if (!fs.existsSync(file)) {
    check(`${label}: 文件存在`, false, "缺失");
    return null;
  }
  const text = fs.readFileSync(file, "utf8");
  const r = inspect(text);
  console.log(`  ${r.blocks.length} 个 - id: 块`);
  check(`${label}: 存在 tool-subagent 块`, r.subBlocks.length >= 1, `共 ${r.subBlocks.length} 个`);
  check(`${label}: tool-subagent 里没有 toolFilter / persona 键`, r.bannedHits.length === 0, r.bannedHits.join(", ") || "干净");
  check(`${label}: spawn 块 maxDepth === 1`, r.maxDepth === "1", `实际 ${r.maxDepth || "缺"}`);
  check(`${label}: 启用的插件行全部可解析`, r.unresolved.length === 0, r.unresolved.join(", ") || "全部 OK");
  if (r.skipped.length) console.log(`· 跳过（disabled）: ${r.skipped.join(", ")}`);
  return r.semantic;
}

const tplSub = audit("仓库模板", TEMPLATE);
const instSub = audit("已安装副本", INSTALLED);
if (tplSub !== null && instSub !== null) {
  check("模板与已安装副本的 tool-subagent 块一致", tplSub === instSub, tplSub === instSub ? "" : "不一致，插件可能装回了旧副本");
}

// ---------- tools.js 注册面 ----------
const toolsMod = await import(path.join(REPO, "lib/redteam/tools.js"));
const names = [];
await toolsMod.apply({
  tools: { register(d) { names.push(d?.name || d?.id) } },
  logger: { info() {}, warn() {}, error() {} },
  effect(fn) { const d = fn(); if (typeof d === "function") d() },
  on() {},
  get() { return undefined },
  subagents: {},
  session: {},
});
check("tools.js 注册出 56 个 redteam_* 工具", names.length === 56, `实际 ${names.length}`);
check("工具名全部以 redteam_ 开头", names.every((n) => String(n).startsWith("redteam_")));

// ---------- store.js 运行时冒烟 ----------
const storeMod = await import(path.join(REPO, "lib/redteam/store.js"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "rt-preset-test-"));
const provided = {};
let dispose = null;
storeMod.apply({
  provide(k, v) { provided[k] = v },
  effect(fn) { const d = fn(); if (typeof d === "function") dispose = d },
  logger: { info() {}, warn() {}, error() {} },
}, { root });
const store = provided.redteam;
check("store.js 提供 ctx.redteam", Boolean(store));
const eng = store?.openEngagement?.("测试单位", [], { bindCurrent: false });
const stats = store?.stats?.(eng?.id);
check("store.js openEngagement + stats 正常", Boolean(eng?.id) && stats?.assets === 0, JSON.stringify(stats));
check("store.js 落盘到临时根", fs.existsSync(path.join(root, "engagements")));
if (dispose) dispose();
fs.rmSync(root, { recursive: true, force: true });

if (process.argv.includes("--self-test")) {
  console.log("\n— 反例自检（判据能不能失败）");
  const good = fs.readFileSync(TEMPLATE, "utf8");
  const bad = good.replace(
    /(\n\s+maxDepth:\s*1\n)/,
    "$1        toolFilter:\n          deny:\n            - workflow\n",
  );
  const g = inspect(good);
  const b = inspect(bad);
  check("正例：模板判为干净", g.bannedHits.length === 0);
  check("反例：塞回 toolFilter 后必须被判出来", b.bannedHits.length > 0, b.bannedHits.join(", "));
  const noDepth = inspect(good.replace(/\n\s+maxDepth:\s*1\n/, "\n"));
  check("反例：删掉 maxDepth 必须判失败", noDepth.maxDepth !== "1", `实际 ${noDepth.maxDepth || "缺"}`);
}

console.log(failed === 0 ? "\n全部通过 / all passed" : `\n失败 ${failed} 项 / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
