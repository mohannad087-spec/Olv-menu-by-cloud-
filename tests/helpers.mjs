// تحميل سكربتات المتصفح (assets/*.js) داخل بيئة معزولة للاختبار، بدون أي حزمة إضافية
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// بيحمّل الملفات بالترتيب بنفس السياق (مثل صفحة المتصفح) وبيرجّع السياق: كل دالة/ثابت بالسكربت صار خاصية عليه
export function loadBrowserScripts(...files) {
  const win = {};
  const ctx = vm.createContext({ window: win, document: { addEventListener() {}, getElementById() { return null; } }, console, Intl, Date, Math, Promise });
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, "accounting", "assets", f), "utf8");
    // const/class على مستوى الملف ما بتنعرض كخصائص للسياق، فبنصدّرها يدوياً
    const names = [...code.matchAll(/^(?:async\s+)?(?:function\s+|const\s+)([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    vm.runInContext(code + "\n;" + names.map((n) => `try{globalThis.${n}=${n}}catch(e){}`).join(";"), ctx, { filename: f });
  }
  return ctx;
}

// عميل Supabase وهمي: from(t).select().eq()... بيرجّع {data,error} الجاهزة للجدول (أو دالة بتاخد الاستعلام وبترجّع {data,error})
export function fakeDb(tables) {
  return {
    calls: [],
    from(table) {
      const q = { table, filters: [] };
      const chain = {};
      for (const m of ["select", "eq", "neq", "is", "not", "gte", "lte", "lt", "in", "order", "limit"]) {
        chain[m] = (...a) => { q.filters.push([m, ...a]); return chain; };
      }
      chain.then = (res, rej) => Promise.resolve(typeof tables[table] === "function" ? tables[table](q) : (tables[table] || { data: [], error: null })).then(res, rej);
      return chain;
    },
  };
}
