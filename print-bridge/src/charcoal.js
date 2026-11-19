// بطاقة فحم الأرجيلة: متى وكم بطاقة بتنطبع مع فاتورة الكاش.
// الإعداد بجدول app_settings (key = charcoal_card) كنص JSON: {"enabled":true,"days":[0,1,2,3,4],"from":"08:00","to":"17:00"}
// أيام: 0=الأحد ... 6=السبت، بتوقيت عمّان، وبنحسب على وقت إنشاء الطلب مش وقت الطباعة.
const { buildTicketBuffer } = require("./escpos");
const { buildCharcoalCard } = require("./ticket-charcoal");

const DEFAULT_CFG = { enabled: true, days: [0, 1, 2, 3, 4], from: "08:00", to: "17:00" };

function parseCfg(raw) {
  if (!raw) return { ...DEFAULT_CFG };
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      enabled: v.enabled !== false,
      days: Array.isArray(v.days) ? v.days.map(Number).filter((d) => d >= 0 && d <= 6) : DEFAULT_CFG.days,
      from: /^\d\d:\d\d$/.test(v.from) ? v.from : DEFAULT_CFG.from,
      to: /^\d\d:\d\d$/.test(v.to) ? v.to : DEFAULT_CFG.to,
    };
  } catch (_) { return { ...DEFAULT_CFG }; }
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function ammanParts(ts) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: WEEKDAYS[get("weekday")], minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}
function toMin(s) { const [h, m] = s.split(":").map(Number); return h * 60 + m; }

function isActive(cfg, ts) {
  if (!cfg.enabled) return false;
  const { day, minutes } = ammanParts(ts || Date.now());
  return cfg.days.includes(day) && minutes >= toMin(cfg.from) && minutes < toMin(cfg.to);
}

const norm = (s) => String(s || "").replace(/[أإآ]/g, "ا");
function isHookah(it) {
  return /ار(ا)?جيل/.test(norm(it.category)) || /ار(ا)?جيل/.test(norm(it.product_name));
}

// عدد الأراجيل بالطلب (مجموع الكميات، بدون الأصناف الملغية)
function hookahCount(items) {
  return (items || []).filter((it) => it.status !== "voided" && isHookah(it)).reduce((n, it) => n + (Number(it.qty) || 1), 0);
}

// buffer جاهز للإرسال (كل البطاقات بإرسال واحد) أو null إذا ما في شي ينطبع
function buildCharcoalBuffer(sale, settings) {
  if (sale.kitchen_only) return null;
  const cfg = parseCfg(settings && settings.charcoal_card);
  if (!isActive(cfg, sale.created_at)) return null;
  const n = Math.min(hookahCount(sale.sale_items), 10);
  if (!n) return null;
  const bufs = [];
  for (let i = 1; i <= n; i++) bufs.push(buildTicketBuffer(buildCharcoalCard(sale, i, n), false, 1));
  return Buffer.concat(bufs);
}

module.exports = { parseCfg, isActive, hookahCount, buildCharcoalBuffer, DEFAULT_CFG };
