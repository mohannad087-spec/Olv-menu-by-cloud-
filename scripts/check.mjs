#!/usr/bin/env node
// فحص سريع لأخطاء الصياغة (syntax) بدون أي تبعيات:
// - كل ملف .js / .mjs عبر node --check
// - كل <script> مضمّن داخل ملفات .html
// - ملفات .ts (دوال Supabase) تُتخطّى لأنها تحتاج Deno
// الاستخدام: node scripts/check.mjs            (كل المستودع)
//            node scripts/check.mjs file1 file2 (ملفات محددة)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const SKIP_DIRS = new Set([".git", "node_modules", ".claude", ".agents"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const files = (args.length ? args : walk("."))
  .filter((f) => [".js", ".mjs", ".html"].includes(extname(f)))
  .filter((f) => !f.split(/[\\/]/).some((part) => SKIP_DIRS.has(part)));

let failures = 0;

function checkJs(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (e) {
    failures++;
    console.error(`✗ ${file}\n${String(e.stderr || e.message).trim()}\n`);
  }
}

function checkHtml(file) {
  const html = readFileSync(file, "utf8");
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const code = m[2];
    if (/\bsrc\s*=/.test(attrs) || !code.trim()) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text\/javascript|application\/javascript)$/i.test(type)) continue; // module/json تُتخطّى
    const line = html.slice(0, m.index).split("\n").length;
    try {
      new vm.Script(code, { filename: `${file}:${line}` });
    } catch (e) {
      failures++;
      console.error(`✗ ${file} (inline <script> at line ${line})\n${e.message}\n`);
    }
  }
}

for (const f of files) {
  if (extname(f) === ".html") checkHtml(f);
  else checkJs(f);
}

if (failures) {
  console.error(`${failures} syntax error(s) found.`);
  process.exit(1);
}
console.log(`✓ ${files.length} file(s) OK`);
