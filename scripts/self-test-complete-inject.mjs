#!/usr/bin/env node
/**
 * dsh-purge fork 自测：patch #40（COMPLETE_PROMPT_KEEP_INJECT）在 dsh 0.2.1 上的行为。
 *
 * 三件事必须同时成立，缺一不可：
 *   1. 正对照：真实 0.2.1 形态打完补丁后，hostPromptKeepsInject() 必须变成 true；
 *   2. 反例：同一份未打补丁的文本，hostPromptKeepsInject() 必须是 false（判据能失败）；
 *   3. 行为：complete 模式下注入段被放回最前，且 complete 已含注入时不重复拼。
 *
 * 另外回归 0.1.5 形态，并做 node --check 语法校验。
 * 任一项失败 → 退出码 1。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as core from "../lib/core.js";
import { hostPromptKeepsInject } from "../lib/host-clean.js";

const PATCH = core.ALL_PATCHES.find((p) => p.id === 40);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-fork-test-"));

let failed = 0;
function check(name, cond, detail = "") {
  const mark = cond ? "✓" : "✗";
  if (!cond) failed += 1;
  console.log(`${mark} ${name}${detail ? "  — " + detail : ""}`);
}

// ---- 夹具：dsh 0.2.1 的真实形态（多 requiredContexts 行 + 带过滤的 contexts） ----
const FIXTURE_021 = `const orderTools = (list) => list;
const scopeTarget = (self, scope) => scope;
class SystemPrompt {
	async assemble(scope, assembly, context) {
		const completeSection = this.complete ? { name: "base", text: "BASE" } : void 0;
		const runtimeContextSuppressed = false;
		const contextByName = new Map();
		const collected = [];
		const tools = orderTools(collected, this.toolOrder, []);
		const variables = {};
		const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
		if (completeSection === void 0 && !runtimeContextSuppressed) return transformed;
		const requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));
		return {
			...transformed,
			sections: completeSection === void 0 ? transformed.sections : [completeSection],
			contexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts
		};
	}
}
export { SystemPrompt };
`;

// ---- 夹具：dsh 0.1.5 形态（原有 pattern 第一个变体就该命中） ----
const FIXTURE_015 = `const orderTools = (list) => list;
const scopeTarget = (self, scope) => scope;
class SystemPrompt {
	async assemble(scope, assembly, context) {
		const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
		if (completeSection === void 0 && !runtimeContextSuppressed) return transformed;
		return {
			...transformed,
			sections: completeSection === void 0 ? transformed.sections : [completeSection],
			contexts: runtimeContextSuppressed ? [] : transformed.contexts
		};
	}
}
export { SystemPrompt };
`;

console.log("dsh-purge fork 自测 / patch #40 on dsh 0.2.1\n");
check("patch #40 存在且带 markers", Boolean(PATCH) && Array.isArray(PATCH.markers), PATCH?.markers?.join(",") || "missing");

// ---------- 反例：未打补丁的 0.2.1 文本必须判为「脏」 ----------
check(
  "反例：未打补丁的 0.2.1 文本 hostPromptKeepsInject() === false",
  hostPromptKeepsInject(FIXTURE_021) === false,
  "若这条变成 true，说明判据恒真，整个自测作废",
);

// ---------- 正对照：打完补丁必须判为「干净」 ----------
const applied = core.applyReplacementsToText(FIXTURE_021, PATCH, "index.js");
check("0.2.1 夹具被打补丁（changed === true）", applied.changed === true);
check(
  "产物里不再有 dropsInject 锚点",
  applied.text.includes("transformed.sections : [completeSection]") === false,
);
check("产物里写入 host-clean 标记", applied.text.includes("[dsh-purge] complete prompt keeps inject"));
check("产物里保留 patch 自身 marker", applied.text.includes("fold-complete inject first"));
check("正对照：打完补丁 hostPromptKeepsInject() === true", hostPromptKeepsInject(applied.text) === true);
check("requiredContexts 行未被破坏", applied.text.includes("const requiredContexts = new Set("));
check("contexts 过滤逻辑保持原样", applied.text.includes("requiredContexts.has(entry.name)"));

// ---------- 幂等：再打一次不应再改 ----------
const again = core.applyReplacementsToText(applied.text, PATCH, "index.js");
check("幂等：第二次应用不再改动", again.changed === false);

// ---------- 回归：0.1.5 形态仍然能匹配 ----------
const old = core.applyReplacementsToText(FIXTURE_015, PATCH, "index.js");
check("回归：0.1.5 形态仍被打补丁", old.changed === true && old.text.includes("fold-complete inject first"));

// ---------- 语法校验 ----------
function syntaxCheck(text, tag) {
  const fp = path.join(TMP, `${tag}.mjs`);
  fs.writeFileSync(fp, text, "utf8");
  try {
    execFileSync(process.execPath, ["--check", fp], { stdio: "pipe" });
    return { ok: true, fp };
  } catch (error) {
    return { ok: false, fp, err: String(error.stderr || error.message).split("\n").slice(0, 3).join(" ") };
  }
}
const synNew = syntaxCheck(applied.text, "patched-021");
check("node --check：补丁产物语法有效", synNew.ok, synNew.ok ? "" : synNew.err);
const synOld = syntaxCheck(old.text, "patched-015");
check("node --check：0.1.5 产物语法有效", synOld.ok, synOld.ok ? "" : synOld.err);

// ---------- 行为：complete 模式下注入段回到最前 ----------
async function behavior(text, tag) {
  const fp = path.join(TMP, `${tag}.mjs`);
  fs.writeFileSync(fp, text, "utf8");
  const mod = await import(pathToFileURL(fp).href);
  const make = (completeText) => ({
    complete: true,
    toolOrder: [],
    ctx: {
      waterfall: async () => ({
        sections: [
          { name: "dsh-purge", text: "INJECT" },
          { name: "base", text: completeText },
        ],
        contexts: [{ name: "ctx-a", required: true }],
      }),
    },
  });
  const bare = new mod.SystemPrompt();
  Object.assign(bare, make("BASE"));
  const r1 = await bare.assemble({}, { sections: [] }, {});
  const folded = new mod.SystemPrompt();
  Object.assign(folded, make("INJECT\n\nBASE"));
  const r2 = await folded.assemble({}, { sections: [] }, {});
  return { r1, r2 };
}

const behave = await behavior(applied.text, "behave-021");
check(
  "行为：complete 段不含注入时，注入被拼到最前",
  behave.r1.sections.length === 1 && behave.r1.sections[0].text === "INJECT\n\nBASE",
  JSON.stringify(behave.r1.sections),
);
check(
  "行为：complete 段已含注入时不重复拼",
  behave.r2.sections.length === 1 && behave.r2.sections[0].text === "INJECT\n\nBASE",
  JSON.stringify(behave.r2.sections),
);
check(
  "行为：contexts 过滤仍然生效（留下 required）",
  Array.isArray(behave.r1.contexts) && behave.r1.contexts.length === 1,
  JSON.stringify(behave.r1.contexts),
);

// ---------- 真机只读自检：当前安装的 dsh-system-prompt 是什么状态 ----------
const REAL = "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js";
if (fs.existsSync(REAL)) {
  const real = fs.readFileSync(REAL, "utf8");
  const dirty = hostPromptKeepsInject(real) === false;
  console.log(
    `\n· 本机 ${REAL}\n  hostPromptKeepsInject = ${!dirty}` +
      (dirty ? "（还没打 #40；装好本 fork 后点一次「应用」即可）" : "（已干净）"),
  );
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed === 0 ? "\n全部通过 / all passed" : `\n失败 ${failed} 项 / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
