#!/usr/bin/env node
/*
 * 自检脚本：用与 LiteMonitor 插件引擎（src/Plugins/PluginProcessor.cs、
 * PluginExecutor.cs）等价的解析/变换逻辑，对真实接口跑一遍所有「显示类别」，
 * 验证 extract 路径、正则、格式化与输出渲染是否正确。
 *
 * 用法：node tools/verify-plugin.js
 * 前提：本机 TokenTracker 正在运行（默认 http://127.0.0.1:17680）。
 */

const fs = require("node:fs");
const path = require("node:path");

const PLUGIN_PATH = path.join(__dirname, "..", "TokenTracker.json");
const tpl = JSON.parse(fs.readFileSync(PLUGIN_PATH, "utf8"));

// ---------- 与 PluginProcessor.cs 等价的实现 ----------
function jsonElementToString(el) {
  if (el === null || el === undefined) return "";
  if (typeof el === "string") return el;
  if (typeof el === "number" || typeof el === "boolean") return String(el);
  return JSON.stringify(el);
}

function extractJsonValue(root, pathStr) {
  try {
    if (!pathStr.includes(".") && !pathStr.includes("[")) {
      if (root && typeof root === "object" && pathStr in root) return jsonElementToString(root[pathStr]);
      return "?";
    }
    let current = root;
    for (const part of pathStr.split(".")) {
      if (part.includes("[") && part.endsWith("]")) {
        const idxStart = part.indexOf("[");
        const name = part.slice(0, idxStart);
        const index = Number.parseInt(part.slice(idxStart + 1, -1), 10);
        if (Number.isNaN(index)) return "?";
        if (name) {
          if (current === null || typeof current !== "object" || !(name in current)) return "?";
          current = current[name];
        }
        if (!Array.isArray(current) || index >= current.length) return "?";
        current = current[index];
      } else {
        if (current === null || typeof current !== "object" || !(part in current)) return "?";
        current = current[part];
      }
    }
    return jsonElementToString(current);
  } catch {
    return "?";
  }
}

const TEMPLATE_RE = /\{\{(.+?)\}\}/g;

function resolveTemplate(template, ctx) {
  if (!template || !template.includes("{{")) return template || "";
  return template.replace(TEMPLATE_RE, (_m, raw) => {
    const content = raw.trim();
    const qIdx = content.indexOf("?");
    const cIdx = content.lastIndexOf(":");
    if (qIdx > 0 && cIdx > qIdx && content[qIdx + 1] !== "?") {
      const condKey = content.slice(0, qIdx).trim();
      const truePart = content.slice(qIdx + 1, cIdx).trim();
      const falsePart = content.slice(cIdx + 1).trim();
      const isTrue = condKey in ctx && ctx[condKey] !== "";
      const target = isTrue ? truePart : falsePart;
      if (target.length >= 2 && ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'")))) {
        return target.slice(1, -1);
      }
      return target in ctx ? ctx[target] : "";
    }
    if (content.includes("??")) {
      for (const part of content.split("??").filter(Boolean)) {
        const key = part.trim();
        if (key.length >= 2 && ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))) {
          return key.slice(1, -1);
        }
        if (key in ctx && ctx[key] !== "") return ctx[key];
      }
      return "";
    }
    return content in ctx ? ctx[content] : "";
  });
}

function regexReplace(val, t, ctx) {
  try {
    let replacement = t.to ?? "";
    if (replacement.includes("{{")) replacement = resolveTemplate(replacement, ctx);
    return val.replace(new RegExp(t.pattern), replacement);
  } catch {
    return val;
  }
}

function regexMatch(val, t) {
  try {
    const m = new RegExp(t.pattern).exec(val);
    if (m) {
      let groupIndex = 1;
      const parsed = Number.parseInt(t.to, 10);
      if (!Number.isNaN(parsed)) groupIndex = parsed;
      if (groupIndex < m.length) return m[groupIndex];
    }
    return "";
  } catch {
    return "";
  }
}

function applyMap(val, t) {
  if (t.map && Object.prototype.hasOwnProperty.call(t.map, val)) return t.map[val];
  return val;
}

function thresholdSwitch(val, t) {
  const numVal = Number.parseFloat(val);
  if (!Number.isNaN(numVal)) {
    if (t.value_map && Object.keys(t.value_map).length > 0) {
      const sorted = Object.entries(t.value_map)
        .map(([k, v]) => [Number.parseFloat(k), v])
        .filter(([k]) => !Number.isNaN(k))
        .sort((a, b) => a[0] - b[0]);
      let result = sorted[0][1];
      for (const [th, v] of sorted) {
        if (numVal >= th) result = v;
        else break;
      }
      return result;
    }
    return "0";
  }
  return "0";
}

function applyTransforms(transforms, ctx) {
  if (!transforms) return;
  for (const t of transforms) {
    const src = t.source || t.var;
    if (!(src in ctx)) continue;
    const val = ctx[src];
    let out = val;
    switch (t.function) {
      case "regex_replace": out = regexReplace(val, t, ctx); break;
      case "regex_match": out = regexMatch(val, t); break;
      case "map": out = applyMap(val, t); break;
      case "resolve_template": out = resolveTemplate(val, ctx); break;
      case "threshold_switch": out = thresholdSwitch(val, t); break;
      default: break;
    }
    ctx[t.var] = out;
  }
}

// ---------- 模拟一次插件执行 ----------
function buildContext(target) {
  const ctx = {};
  for (const input of tpl.inputs || []) {
    if (input.scope === "target") {
      ctx[input.key] = target && input.key in target ? target[input.key] : input.default;
    } else {
      ctx[input.key] = input.default;
    }
  }
  return ctx;
}

async function runTarget(target) {
  const ctx = buildContext(target);
  for (const step of tpl.execution.steps) {
    const url = resolveTemplate(step.url, ctx);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const body = await res.json();
    for (const [key, p] of Object.entries(step.extract || {})) {
      ctx[key] = extractJsonValue(body, p);
    }
    applyTransforms(step.process, ctx);
  }
  applyTransforms(tpl.execution.process, ctx);
  return ctx;
}

function renderOutputs(ctx) {
  return (tpl.outputs || []).map((o) => ({
    key: o.key,
    label: resolveTemplate(o.label || "", ctx),
    short: resolveTemplate(o.short_label || "", ctx),
    value: resolveTemplate(o.format_val || "", ctx) || "?",
    color: resolveTemplate(o.color || "", ctx),
    unit: resolveTemplate(o.unit || "", ctx),
  }));
}

(async () => {
  const modes = (tpl.inputs.find((i) => i.key === "display_mode")?.options || []).map((o) => o.value);
  let failed = false;

  for (const mode of modes) {
    try {
      const ctx = await runTarget({ display_mode: mode });
      const outs = renderOutputs(ctx);
      console.log(`\n=== display_mode = ${mode} ===`);
      console.log(`  今日原始: billable=${ctx.today_tokens} total=${ctx.today_total} 7天花费=${ctx.cost_7d}`);
      console.log(`  滚动: 7天=${ctx.week_tokens} (会话${ctx.week_conv}) 30天=${ctx.month_tokens} 日均=${ctx.month_avg}`);
      console.log(`  累计: billable=${ctx.total_tokens} total=${ctx.total_all_tokens} 花费=${ctx.total_cost} 会话=${ctx.total_conv}`);
      for (const o of outs) {
        console.log(`  [${o.key}] label="${o.label}" short="${o.short}" value="${o.value}${o.unit}" color=${o.color}`);
      }
      const main = outs.find((o) => o.key === "main");
      if (!main || main.value === "?" || main.value === "") {
        console.error(`  !! main 输出为空 (${JSON.stringify(main)})`);
        failed = true;
      }
    } catch (e) {
      console.error(`\n=== display_mode = ${mode} === 失败: ${e.message}`);
      failed = true;
    }
  }

  console.log("\n结果:", failed ? "存在失败项" : "全部通过");
  process.exitCode = failed ? 1 : 0;
})();
