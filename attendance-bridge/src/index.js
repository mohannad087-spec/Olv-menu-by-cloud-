// برنامج جسر البصمة: يعمل باستمرار على نفس الجهاز يلي شغّال عليه جسر
// الطباعة (print-bridge)، يتصل بجهاز Hikvision (بروتوكول ISAPI عبر
// الشبكة، مصادقة Digest — راجع digest-client.js) ويسحب سجل أحداث التحكم
// بالدخول (كل نجاح تحقق: وجه/بصمة/كرت حسب الجهاز)، ويحفظ كل بصمة جديدة
// في جدول employee_punches بعد ما يطابقها بالموظف عبر عمود device_user_id
// (رقم الموظف "Employee No." المسجَّل على الجهاز نفسه عند تسجيل وجهه —
// يُضبط مرة وحدة من صفحة الموظفين). راجع README.md لخطوات التركيب.
//
// ليش نسحب نافذة زمنية كاملة كل مرة (LOOKBACK_HOURS ساعة للخلف) بدل
// تتبّع "آخر نقطة توقفنا عندها"؟ لأنه أبسط وأكثر أمانًا: قيد
// UNIQUE(profile_id, punched_at) بقاعدة البيانات + ON CONFLICT DO
// NOTHING (عبر ignoreDuplicates) يضمنان تجاهل أي بصمة سبق حفظها
// تلقائيًا، فمافي داعي لحفظ وتتبّع أي "مؤشر" هش قد ينكسر لو انقطع
// البرنامج أو أعيد تشغيله أو الجهاز نفسه.

require("dotenv").config();
const { searchAllAcsEvents, listDeviceUsers } = require("./hikvision");

// وضعان للحفظ: (1) الأبسط والأأمن: BRIDGE_TOKEN + SUPABASE_URL، الجسر بيرسل البصمات
// لدالة attendance-ingest بالسحابة بدون أي مفتاح سري عالكمبيوتر. (2) القديم:
// SUPABASE_SERVICE_KEY مباشرة.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;
const USE_INGEST = !!(BRIDGE_TOKEN && process.env.SUPABASE_URL);
const supabase = USE_INGEST ? null : require("./supabase").supabase;

async function ingest(events, users) {
  const res = await fetch(`${process.env.SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/attendance-ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bridge-token": BRIDGE_TOKEN },
    body: JSON.stringify({ events, users }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new Error(`رفضت السحابة البصمات (${res.status}): ${out.error || "رد غير متوقع"}`);
  return out;
}

const DEVICE_IP = process.env.DEVICE_IP;
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 80);
const DEVICE_USER = process.env.DEVICE_USER || "admin";
const DEVICE_PASSWORD = process.env.DEVICE_PASSWORD;
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || 72);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30000);

if (!DEVICE_IP || !DEVICE_PASSWORD) {
  console.error("خطأ: تأكد من ضبط DEVICE_IP و DEVICE_PASSWORD في ملف .env");
  process.exit(1);
}

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString("ar-EG", { numberingSystem: "latn" })}]`, ...args);
}

async function loadDeviceUserMap() {
  const { data, error } = await supabase
    .from("profiles").select("id, device_user_id").not("device_user_id", "is", null);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) map.set(String(row.device_user_id), row.id);
  return map;
}

// أسماء الموظفين على الجهاز: كل 10 دقايق، والسحابة بتربط بالاسم أي موظف لسا ما إله رقم
let lastUsersSync = 0;
async function syncUsers() {
  if (!USE_INGEST || Date.now() - lastUsersSync < 10 * 60 * 1000) return;
  lastUsersSync = Date.now();
  try {
    const users = await listDeviceUsers({ host: DEVICE_IP, port: DEVICE_PORT, username: DEVICE_USER, password: DEVICE_PASSWORD });
    const out = await ingest([], users);
    if (out.linked && out.linked.length) log(`تم ربط موظفين بالاسم مع رقمهم على الجهاز: ${out.linked.join("، ")}`);
  } catch (err) {
    log("تنبيه: ما قدرت أقرأ أسماء الموظفين من الجهاز:", err.message);
  }
}

async function tick() {
  try {
    await syncUsers();
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_HOURS * 3600000);

    const [userMap, events] = await Promise.all([
      USE_INGEST ? Promise.resolve(null) : loadDeviceUserMap(),
      searchAllAcsEvents({
        host: DEVICE_IP, port: DEVICE_PORT, username: DEVICE_USER, password: DEVICE_PASSWORD,
        startTime: from.toISOString(), endTime: now.toISOString(),
      }),
    ]);

    if (!events.length) {
      log("لا يوجد أحداث جديدة على الجهاز خلال آخر", LOOKBACK_HOURS, "ساعة.");
      return;
    }

    if (USE_INGEST) {
      const list = events
        .filter((ev) => ev.employeeNoString && ev.time)
        .map((ev) => ({ employeeNo: String(ev.employeeNoString).trim(), time: ev.time }));
      if (!list.length) { log("لا يوجد بصمات مرتبطة بموظفين خلال هذه الدورة."); return; }
      for (let i = 0; i < list.length; i += 500) {
        const out = await ingest(list.slice(i, i + 500));
        if (out.unmapped && out.unmapped.length) {
          log(`تحذير: بصمات من رقم/أرقام موظفين غير مربوطة بأي حساب (${out.unmapped.join("، ")}) — اربط "رقم الموظف على جهاز البصمة" من صفحة الموظفين.`);
        }
        log(`أُرسلت ${out.received} بصمة، حُفظ منها ${out.saved} (المكرر يُتجاهل تلقائيًا).`);
      }
      return;
    }

    const rows = [];
    const unmapped = new Set();
    for (const ev of events) {
      const employeeNo = String(ev.employeeNoString || "").trim();
      const punchTime = ev.time;
      if (!employeeNo || !punchTime) continue; // حدث نظام/تنبيه مو مرتبط بموظف — نتجاهله
      const profileId = userMap.get(employeeNo);
      if (!profileId) {
        unmapped.add(employeeNo);
        continue;
      }
      rows.push({
        profile_id: profileId,
        punched_at: new Date(punchTime).toISOString(),
        source: "fingerprint",
      });
    }

    if (unmapped.size) {
      log(`تحذير: بصمات من رقم/أرقام موظفين غير مربوطة بأي حساب (${[...unmapped].join("، ")}) — اربط "رقم الموظف على جهاز البصمة" من صفحة الموظفين.`);
    }

    if (rows.length) {
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("employee_punches")
          .upsert(chunk, { onConflict: "profile_id,punched_at", ignoreDuplicates: true });
        if (error) throw error;
      }
      log(`تمت مزامنة ${rows.length} بصمة من الجهاز (البصمات المحفوظة مسبقًا تُتجاهل تلقائيًا).`);
    } else {
      log("لا يوجد بصمات جديدة مربوطة بموظفين خلال هذه الدورة.");
    }
  } catch (err) {
    const why = err.cause ? ` (${err.cause.code || err.cause.message})` : "";
    log("خطأ أثناء دورة فحص البصمة:", err.message + why);
  } finally {
    setTimeout(tick, POLL_INTERVAL_MS);
  }
}

log("بدء تشغيل برنامج جسر البصمة (Hikvision ISAPI)...");
log(`يفحص جهاز الحضور كل ${POLL_INTERVAL_MS / 1000} ثانية (نافذة ${LOOKBACK_HOURS} ساعة للخلف في كل مرة). اتركه يعمل باستمرار.`);
tick();
