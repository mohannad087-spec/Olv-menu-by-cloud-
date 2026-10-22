// الطباعة بدون نت: وقت انقطاع النت الكاشير بيبعت الطلب لـ«سيرفر المحل» (local-server) على نفس الكمبيوتر،
// وهالملف بيسحب مهام الطباعة منه، بيوزّعها على الطابعات حسب الأقسام (متل ما بيعمل trigger السحابة)،
// وبيطبعها مباشرة على الشبكة المحلية. الطابعات وتصاميمها بنحفظ نسخة منها لما النت شغّال.
const fs = require("fs");
const path = require("path");
const { sendToPrinter } = require("./printer");
const { buildTicketBuffer } = require("./escpos");
const { buildKitchenTicket } = require("./ticket-kitchen");
const { buildReceiptTicket } = require("./ticket-receipt");

const LOCAL_URL = String(process.env.LOCAL_SERVER_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const CACHE_FILE = path.join(__dirname, "..", "printer-cache.json");
const PRINTED_FILE = path.join(__dirname, "..", "printed-local.json");
const KEEP_MS = 3 * 24 * 3600 * 1000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// نسخة من إعدادات الطابعات (بتتحدّث كل ما نجح القراءة من السحابة)
function saveCache(settings, printers) {
  try { writeJson(CACHE_FILE, { settings: settings || {}, printers: [...printers.values()], saved_at: new Date().toISOString() }); } catch (_) { /* مش حرج */ }
}
function loadCache() {
  const c = readJson(CACHE_FILE, null);
  if (!c) return null;
  return { settings: c.settings || {}, printers: new Map((c.printers || []).map((p) => [p.id, p])) };
}

// مبيعات انطبعت محليًا (client_ref): لما يرجع النت وتوصل نسخة المبيعات للسحابة وتتولّد مهام طباعة
// عادية، بنتجاهلها حتى ما تنطبع الفاتورة مرتين
const printed = readJson(PRINTED_FILE, {});
function wasPrintedLocally(ref) { return !!(ref && printed[ref]); }
function markPrinted(ref) {
  printed[ref] = Date.now();
  for (const [k, t] of Object.entries(printed)) if (Date.now() - t > KEEP_MS) delete printed[k];
  try { writeJson(PRINTED_FILE, printed); } catch (_) { /* مش حرج */ }
}

async function localCall(route, body) {
  const res = await fetch(`${LOCAL_URL}/_local/${route}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`local-server ${res.status}`);
  return res.json();
}

// يحوّل مهمة محلية لنفس شكل sales_entries + sale_items اللي بتفهمه دوال الرسم
function toSale(job) {
  const s = job.sale;
  return {
    order_no: s.order_no, created_at: s.created_at, order_type: s.order_type,
    table_number: s.table_number, customer_name: s.customer_name, customer_phone: s.customer_phone,
    created_by_profile: s.cashier_name ? { full_name: s.cashier_name } : null,
    cash_amount: s.cash_amount, card_amount: s.card_amount, delivery_amount: s.delivery_amount,
    discount_amount: s.discount_amount, cash_received: s.cash_received, change_due: s.change_due,
    sale_items: s.items.map((it) => ({ ...it, status: "completed" })),
  };
}

// التوزيع: الفاتورة الكاملة لطابعات الكاشير، وكل قسم بياخد أصنافه (حسب تصنيفها)، والأصناف اللي
// ما إلها قسم بتروح للقسم اللي «ياخد الباقي». لو ما في طابعات معرّفة: الإعدادات القديمة (مطبخ + فاتورة)
function route(sale, cfg) {
  const out = [];
  const { settings, printers } = cfg;
  const list = [...printers.values()];
  if (!list.length) {
    if (settings.receipt_enabled && settings.receipt_ip) out.push({ kind: "receipt", label: "الفاتورة", ip: settings.receipt_ip, port: settings.receipt_port || 9100, items: sale.sale_items, layout: null });
    if (settings.kitchen_enabled && settings.kitchen_ip) out.push({ kind: "station", label: "تذكرة المطبخ", ip: settings.kitchen_ip, port: settings.kitchen_port || 9100, items: sale.sale_items, layout: null });
    return out;
  }
  const stations = list.filter((p) => p.enabled && p.kind === "station").sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const claimed = new Set(stations.flatMap((p) => p.categories || []));
  for (const p of list.filter((x) => x.enabled && x.kind === "receipt")) {
    out.push({ kind: "receipt", printer: p, label: p.name, ip: p.ip, port: p.port || 9100, items: sale.sale_items, layout: p.ticket_layout, drawer: !!p.open_drawer });
  }
  for (const p of stations) {
    const items = sale.sale_items.filter((it) => (p.categories || []).includes(it.category || "") || (p.catch_unassigned && !claimed.has(it.category || "")));
    if (items.length) out.push({ kind: "station", printer: p, label: p.name, ip: p.ip, port: p.port || 9100, items, layout: p.ticket_layout });
  }
  return out.filter((t) => t.ip);
}

// أقسام انطبعت لمهمة فشل جزء منها: ما بنعيد طباعتها بالمحاولة الجاية
const partial = new Map();

async function printJob(job, cfg, log) {
  const sale = toSale(job);
  const doneSet = partial.get(job.id) || new Set();
  partial.set(job.id, doneSet);
  const targets = route(sale, cfg);
  if (!targets.length) throw new Error("ما في طابعات معرّفة");
  const stationCount = targets.filter((t) => t.kind === "station").length;
  const errors = [];
  for (const t of targets) {
    if (doneSet.has(t.label)) continue;
    try {
      const canvas = t.kind === "receipt"
        ? buildReceiptTicket(sale, cfg.settings, null, t.layout)
        : buildKitchenTicket({ ...sale, sale_items: t.items }, t.printer ? t.printer.name : null, stationCount > 1, t.layout);
      await sendToPrinter(t.ip, t.port, buildTicketBuffer(canvas, !!t.drawer));
      doneSet.add(t.label);
      log(`✓ (بدون نت) طُبع على "${t.label}" — طلب ${job.order_no}`);
    } catch (e) {
      errors.push(`${t.label}: ${e.message}`);
      log(`✗ (بدون نت) فشلت الطباعة على "${t.label}":`, e.message);
    }
  }
  if (errors.length) throw new Error(errors.join(" | "));
  partial.delete(job.id);
}

// بتنادى كل ثانية تقريباً. بتشتغل بدون نت لأنها بتحكي مع سيرفر المحل بس. تذكرة طبعت مرة ما بتنعاد حتى لو طابعة تانية فشلت
// المهمة بتنعاد لحد ما كل الطابعات تنجح (بدون ما نعيد الطباعة على اللي نجحت)
let lastNoCacheLog = 0; // الحلقة سريعة: لا نكرر الرسالة كل ثانية
async function runLocalQueue(cloudCfg, log) {
  let jobs;
  try { jobs = (await localCall("print-queue")).jobs || []; } catch (_) { return; } // سيرفر المحل مش شغّال: عادي
  if (!jobs.length) return;
  const cfg = cloudCfg || loadCache();
  if (!cfg) {
    if (Date.now() - lastNoCacheLog > 60000) { lastNoCacheLog = Date.now(); log("طباعة بدون نت: ما في نسخة محفوظة من الطابعات (لازم الجسر يشتغل مرة والنت شغّال)"); }
    return;
  }
  for (const job of jobs) {
    try {
      await printJob(job, cfg, log);
      markPrinted(job.id);
      await localCall("print-done", { id: job.id, ok: true }).catch(() => {});
    } catch (e) {
      await localCall("print-done", { id: job.id, ok: false, error: e.message }).catch(() => {});
    }
  }
}

module.exports = { saveCache, loadCache, runLocalQueue, wasPrintedLocally };
