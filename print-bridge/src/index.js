// برنامج جسر الطباعة: يعمل باستمرار على جهاز كمبيوتر متصل بنفس شبكة
// المطعم التي تتصل بها الطابعات الحرارية الشبكية، ويراقب جدول print_jobs
// في Supabase (يُنشأ صف فيه تلقائيًا عند كل عملية بيع من شاشة "بيع سريع"
// أو "المبيعات")، ويرسل نسخة مطبخ ونسخة فاتورة للطابعة المناسبة.
// راجع README.md لخطوات التركيب والتشغيل.

const { supabase } = require("./supabase");
const { sendToPrinter } = require("./printer");
const { buildTicketBuffer } = require("./escpos");
const { buildKitchenTicket } = require("./ticket-kitchen");
const { buildReceiptTicket } = require("./ticket-receipt");

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 4000);

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString("ar-EG", { numberingSystem: "latn" })}]`, ...args);
}

async function loadPrinterSettings() {
  const { data, error } = await supabase
    .from("printer_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data || {};
}

async function loadSaleWithItems(saleId) {
  // created_by_profile!created_by يحدد صراحة عمود created_by (بدل
  // voided_by) لأن sales_entries فيها أكتر من عمود يشير لـprofiles —
  // بدون هالتحديد PostgREST بيرفض الطلب بخطأ "غموض العلاقة"
  const { data, error } = await supabase
    .from("sales_entries")
    .select("*, sale_items(*), created_by_profile:profiles!created_by(full_name)")
    .eq("id", saleId).maybeSingle();
  if (error) throw error;
  return data;
}

async function loadPrinters() {
  const { data, error } = await supabase.from("printers").select("*");
  // الجدول ممكن لسا مو موجود (تحديث البرنامج قبل تشغيل schema-printers-routing.sql)
  // — بهالحالة ما في مهام موزّعة أصلًا والمسار القديم كافي
  if (error && (error.code === "42P01" || error.code === "PGRST205")) return new Map();
  if (error) throw error;
  return new Map((data || []).map((p) => [p.id, p]));
}

async function markJob(jobId, fields) {
  const { error } = await supabase.from("print_jobs").update(fields).eq("id", jobId);
  if (error) log("تعذّر تحديث حالة مهمة الطباعة:", error.message);
}

// مهمة مرتبطة بطابعة محددة (printer_id) = مسار التوزيع الجديد: الوجهة من
// جدول printers، وأصناف التذكرة محددة مسبقًا بـitem_ids لحظة تسجيل البيع.
// مهمة بدون printer_id = المسار القديم (طابعة مطبخ + طابعة فاتورة من
// printer_settings) لما ما في أي طابعة معرّفة بجدول printers أصلًا
async function processJob(job, settings, printers, saleCache) {
  const printer = job.printer_id ? printers.get(job.printer_id) : null;
  if (job.printer_id && !printer) {
    await markJob(job.id, { status: "error", error_message: "الطابعة المرتبطة بهذه المهمة انحذفت" });
    return;
  }
  const target = printer
    ? { enabled: printer.enabled, ip: printer.ip, port: printer.port }
    : job.job_type === "kitchen"
      ? { enabled: settings.kitchen_enabled, ip: settings.kitchen_ip, port: settings.kitchen_port }
      : { enabled: settings.receipt_enabled, ip: settings.receipt_ip, port: settings.receipt_port };
  const label = printer ? printer.name : (job.job_type === "kitchen" ? "تذكرة المطبخ" : "الفاتورة");

  if (!target.enabled || !target.ip) {
    await markJob(job.id, { status: "skipped" });
    return;
  }

  try {
    if (!saleCache.has(job.sale_id)) {
      saleCache.set(job.sale_id, await loadSaleWithItems(job.sale_id));
    }
    const sale = saleCache.get(job.sale_id);
    if (!sale) throw new Error("تعذّر إيجاد بيانات عملية البيع المرتبطة بهذه المهمة");

    let canvas;
    if (job.job_type === "kitchen") {
      const itemIds = job.item_ids ? new Set(job.item_ids) : null;
      const stationSale = itemIds
        ? { ...sale, sale_items: (sale.sale_items || []).filter((it) => itemIds.has(it.id)) }
        : sale;
      canvas = buildKitchenTicket(stationSale, printer ? printer.name : null);
    } else {
      canvas = buildReceiptTicket(sale, settings);
    }

    const buffer = buildTicketBuffer(canvas);
    await sendToPrinter(target.ip, target.port || 9100, buffer);

    await markJob(job.id, { status: "printed", printed_at: new Date().toISOString(), error_message: null });
    log(`✓ تمت الطباعة على "${label}" لعملية بيع ${job.sale_id}`);
  } catch (err) {
    await markJob(job.id, { status: "error", error_message: err.message });
    log(`✗ فشلت الطباعة على "${label}":`, err.message);
  }
}

async function tick() {
  try {
    const settings = await loadPrinterSettings();
    const printers = await loadPrinters();
    const { data: jobs, error } = await supabase
      .from("print_jobs").select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(20);
    if (error) throw error;
    if (jobs && jobs.length) {
      const saleCache = new Map();
      for (const job of jobs) {
        await processJob(job, settings, printers, saleCache);
      }
    }
  } catch (err) {
    log("خطأ أثناء دورة فحص الطباعة:", err.message);
  } finally {
    setTimeout(tick, POLL_INTERVAL_MS);
  }
}

log("بدء تشغيل برنامج جسر الطباعة...");
log(`يفحص الطلبات الجديدة كل ${POLL_INTERVAL_MS / 1000} ثانية. اتركه يعمل باستمرار.`);
tick();
