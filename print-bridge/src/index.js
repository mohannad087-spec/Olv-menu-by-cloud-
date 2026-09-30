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
const { buildCancelTicket, buildTestTicket, buildLayoutSampleTicket } = require("./ticket-extra");

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 4000);
// مهمة تحضير/إلغاء أقدم من هالمدة (مثلاً بعد انقطاع طويل) ما بتنطبع تلقائيًا —
// بتنتظر قرار الكاشير من صفحة الإعدادات، بدل ما تنطبع طلبات قديمة دفعة وحدة
const STALE_MINUTES = Number(process.env.STALE_MINUTES || 15);
// مهمة عالقة بحالة "printing" أكتر من هالمدة = البرنامج انقطع أثناء الطباعة
const PRINTING_TIMEOUT_MINUTES = 2;

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

// هل للطلب مهام تحضير على أقسام تانية (غير هالطابعة)؟
async function hasOtherStations(job) {
  if (!job.printer_id || !job.sale_id) return false;
  const { data, error } = await supabase
    .from("print_jobs").select("printer_id, status").eq("sale_id", job.sale_id).eq("job_type", "kitchen");
  if (error) return false;
  return (data || []).some((j) => j.printer_id && j.printer_id !== job.printer_id && j.status !== "skipped");
}

// حجز ذرّي: update شرطي (status=pending) — لو نسختين من البرنامج اشتغلوا بنفس
// الوقت، وحدة بس بتنجح بالحجز والتانية بترجع صفر صفوف، فما بتنطبع تذكرة مرتين
let claimWarned = false;
async function claimJob(jobId) {
  const { data, error } = await supabase
    .from("print_jobs")
    .update({ status: "printing", claimed_at: new Date().toISOString() })
    .eq("id", jobId).eq("status", "pending").select("id");
  // 23514/42703 = ملف schema-print-guards.sql لسا ما انشغّل (حالة printing أو
  // عمود claimed_at مو موجودين) — نكمّل بدون حجز بدل ما تتوقف الطباعة كلها
  if (error && (error.code === "23514" || error.code === "42703")) {
    if (!claimWarned) { log("تحذير: شغّل schema-print-guards.sql لتفعيل الحجز ومنع الطباعة المكررة"); claimWarned = true; }
    return true;
  }
  if (error) { log("تعذّر حجز مهمة الطباعة:", error.message); return false; }
  return !!(data && data.length);
}

// مهمة بقيت "printing" = البرنامج (أو الكهرباء) انقطع بين إرسال التذكرة
// وتسجيل نجاحها. ما منعرف إذا انطبعت، فما منعيد الطباعة تلقائيًا (بتتكرر
// تذكرة) ولا منتجاهلها (بتضيع) — بنحوّلها لـ"error" وبيقرر الكاشير
async function recoverStuckJobs() {
  const cutoff = new Date(Date.now() - PRINTING_TIMEOUT_MINUTES * 60000).toISOString();
  const { error } = await supabase
    .from("print_jobs")
    .update({ status: "error", error_message: "انقطع البرنامج أثناء الطباعة — تأكد إذا طلعت التذكرة قبل إعادة المحاولة" })
    .eq("status", "printing").lt("claimed_at", cutoff);
  if (error) log("تعذّر فحص المهام العالقة:", error.message);
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
  const isTest = job.job_type === "test";

  if (!target.enabled || !target.ip) {
    await markJob(job.id, { status: "skipped" });
    return;
  }

  if (!(await claimJob(job.id))) return; // نسخة تانية أخدتها

  const ageMinutes = (Date.now() - new Date(job.created_at).getTime()) / 60000;
  if (job.job_type !== "receipt" && ageMinutes > STALE_MINUTES) {
    await markJob(job.id, { status: "stale", error_message: `تأخرت ${Math.round(ageMinutes)} دقيقة — بانتظار قرار الكاشير` });
    log(`⚠ مهمة متأخرة (${Math.round(ageMinutes)} د) على "${label}" — ما انطبعت تلقائيًا`);
    return;
  }

  try {
    let canvas;
    // تصميم الطابعة (ticket_layout) — null = الشكل الافتراضي (والمسار القديم بلا طابعات)
    const layout = printer ? printer.ticket_layout : null;
    if (isTest) {
      // مهمة تجريبية بتصميم = مثال كامل بنفس بيانات المعاينة، وإلا اختبار اتصال بسيط
      canvas = job.test_layout
        ? buildLayoutSampleTicket(printer, settings, job.test_layout)
        : buildTestTicket(printer, target);
    } else {
      if (!saleCache.has(job.sale_id)) {
        saleCache.set(job.sale_id, await loadSaleWithItems(job.sale_id));
      }
      const sale = saleCache.get(job.sale_id);
      if (!sale) throw new Error("تعذّر إيجاد بيانات عملية البيع المرتبطة بهذه المهمة");

      const itemIds = job.item_ids ? new Set(job.item_ids) : null;
      const jobItems = (sale.sale_items || []).filter((it) => !itemIds || itemIds.has(it.id));
      if (job.job_type === "kitchen") {
        // أي صنف انلغى بين تسجيل الطلب وطباعة التذكرة ما لازم ينطبع للمطبخ
        const liveItems = jobItems.filter((it) => it.status !== "voided");
        if (!liveItems.length) {
          await markJob(job.id, { status: "skipped", error_message: "كل أصناف هذه التذكرة انلغت قبل الطباعة" });
          return;
        }
        canvas = buildKitchenTicket({ ...sale, sale_items: liveItems }, printer ? printer.name : null, await hasOtherStations(job), layout);
      } else if (job.job_type === "cancel") {
        canvas = buildCancelTicket(sale, printer ? printer.name : null, jobItems, layout);
      } else {
        canvas = buildReceiptTicket(
          sale, settings,
          job.reprint_no ? { no: job.reprint_no, reason: job.reprint_reason || "—", by: job.reprint_by } : null,
          layout
        );
      }
    }

    const buffer = buildTicketBuffer(canvas);
    await sendToPrinter(target.ip, target.port || 9100, buffer);

    await markJob(job.id, { status: "printed", printed_at: new Date().toISOString(), error_message: null });
    log(`✓ تمت الطباعة (${job.job_type}) على "${label}"${job.sale_id ? ` لعملية بيع ${job.sale_id}` : ""}`);
  } catch (err) {
    await markJob(job.id, { status: "error", error_message: err.message });
    log(`✗ فشلت الطباعة على "${label}":`, err.message);
  }
}

// نبضة حياة: بتسمح لواجهة النظام تكتشف لو هالبرنامج توقف (الكمبيوتر انطفى
// أو انقطع نت) وتحذّر الكاشير بدل ما تتراكم الطلبات بصمت
async function sendHeartbeat() {
  const { error } = await supabase
    .from("app_settings").upsert({ key: "print_bridge_heartbeat", value: new Date().toISOString() });
  if (error) log("تعذّر إرسال نبضة الحياة:", error.message);
}

async function tick() {
  try {
    await sendHeartbeat();
    await recoverStuckJobs();
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
