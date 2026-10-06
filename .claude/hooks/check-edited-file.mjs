#!/usr/bin/env node
// PostToolUse hook: بعد كل تعديل لملف .js أو .html يفحص صياغته فورًا.
// عند وجود خطأ يخرج بالرمز 2 فيرى Claude الخطأ ويصلحه مباشرة.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const file = input.tool_input?.file_path;
if (!file || !/\.(m?js|html)$/.test(file)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  execFileSync(process.execPath, [join(root, "scripts/check.mjs"), file], { stdio: "pipe" });
} catch (e) {
  process.stderr.write(String(e.stderr || e.stdout || e.message));
  process.exit(2);
}
