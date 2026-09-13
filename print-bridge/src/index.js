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
  console.log(`[${new Date().toLocaleTimeString("ar-EG")}]`, ...args);
}

async function loadPrinterSettings() {
  const { data, error } = await supabase
    .from("printer_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data || {};
}

async function loadSaleWithItems(saleId) {
  const { data, error } = await supabase
    .from("sales_entries").select("*, sale_items(*)").eq("id", saleId).maybeSingle();
  if (error) throw error;
  return data;
}

async function markJob(jobId, fields) {
  const { error } = await supabase.from("print_jobs").update(fields).eq("id", jobId);
  if (error) log("تعذّر تحديث حالة مهمة الطباعة:", error.message);
}

async function processJob(job, settings, saleCache) {
  const target = job.job_type === "kitchen"
    ? { enabled: settings.kitchen_enabled, ip: settings.kitchen_ip, port: settings.kitchen_port }
    : { enabled: settings.receipt_enabled, ip: settings.receipt_ip, port: settings.receipt_port };

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

    const canvas = job.job_type === "kitchen"
      ? buildKitchenTicket(sale)
      : buildReceiptTicket(sale, settings);

    const buffer = buildTicketBuffer(canvas);
    await sendToPrinter(target.ip, target.port || 9100, buffer);

    await markJob(job.id, { status: "printed", printed_at: new Date().toISOString(), error_message: null });
    log(`✓ تمت طباعة ${job.job_type === "kitchen" ? "تذكرة المطبخ" : "الفاتورة"} لعملية بيع ${job.sale_id}`);
  } catch (err) {
    await markJob(job.id, { status: "error", error_message: err.message });
    log(`✗ فشلت طباعة ${job.job_type === "kitchen" ? "تذكرة المطبخ" : "الفاتورة"}:`, err.message);
  }
}

async function tick() {
  try {
    const settings = await loadPrinterSettings();
    const { data: jobs, error } = await supabase
      .from("print_jobs").select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(20);
    if (error) throw error;
    if (jobs && jobs.length) {
      const saleCache = new Map();
      for (const job of jobs) {
        await processJob(job, settings, saleCache);
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
