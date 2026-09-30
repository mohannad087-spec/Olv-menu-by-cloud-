// قراءة فاتورة مورّد (صورة أو PDF) بالذكاء الاصطناعي (Google Gemini، الطبقة
// المجانية) وإرجاع الأصناف والكميات والأسعار كـJSON منظّم. الواجهة بتعبّي فيها
// جدول فواتير المشتريات وصاحب المطعم بيراجع ويصحّح قبل الحفظ — النموذج ما بيحفظ
// شي لحاله أبدًا.
//
// المفتاح (GEMINI_API_KEY) سر بجانب السيرفر بس، ما بيوصل للمتصفح أبدًا.
// الدالة للمالك والمدير فقط (نفس أسلوب manage-employees): Supabase بتتحقق من
// تسجيل الدخول تلقائيًا، وهون بنتحقق من الدور.
//
// أسرار Edge Functions المطلوبة:
//   GEMINI_API_KEY   من https://aistudio.google.com (Get API key) — مجاني
//   GEMINI_MODEL     اختياري (الافتراضي gemini-flash-latest)
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);
// حد أقصى ~6 ميغا بعد ترميز base64 (الواجهة بتصغّر الصور قبل الإرسال)
const MAX_BASE64_CHARS = 8_000_000;

const PROMPT = `أنت قارئ فواتير مشتريات لمطعم. اقرأ فاتورة المورّد المرفقة (عربية أو إنجليزية، مطبوعة أو بخط اليد)
وأرجع البيانات بدقة. القواعد:
- استخرج كل سطر صنف: الاسم كما هو مكتوب، الكمية، الوحدة (كغ، قطعة، كرتونة...) إن وُجدت، سعر الوحدة، وإجمالي السطر.
- استخدم أرقامًا إنجليزية (0-9) وفاصلة عشرية نقطة.
- إذا كان سعر الوحدة غير مكتوب واستطعت حسابه من إجمالي السطر ÷ الكمية فاحسبه. إذا لم تكن متأكدًا اترك الحقل null.
- لا تخترع أصنافًا أو أرقامًا غير موجودة بالصورة، ولا تدمج سطرين.
- تجاهل سطور المجاميع والضريبة والخصم والملاحظات (لا تضعها ضمن الأصناف). ضع الإجمالي النهائي للفاتورة في total.
- التاريخ بصيغة YYYY-MM-DD إن وُجد. رقم الفاتورة واسم المورّد إن وُجدا.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplier_name: { type: "STRING", nullable: true },
    invoice_no: { type: "STRING", nullable: true },
    invoice_date: { type: "STRING", nullable: true },
    total: { type: "NUMBER", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          qty: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", nullable: true },
          unit_price: { type: "NUMBER", nullable: true },
          line_total: { type: "NUMBER", nullable: true },
        },
        required: ["name"],
      },
    },
  },
  required: ["items"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "إعدادات Supabase ناقصة بالسيرفر" }, 500);
  if (!GEMINI_KEY) return json({ ok: false, error: "GEMINI_API_KEY غير مضبوط بأسرار Edge Functions" }, 500);

  // هوية المستدعي ودوره (نفس أسلوب manage-employees)
  const authHeader = req.headers.get("authorization") || "";
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: "جلسة غير صالحة" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile } = await admin.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile || profile.is_active === false || !["owner", "manager"].includes(profile.role)) {
    return json({ ok: false, error: "قراءة الفواتير للمالك والمدير فقط" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح" }, 400);
  }
  const mime = String(body.mime_type || "");
  const data = String(body.data || "");
  if (!ALLOWED_MIME.has(mime)) return json({ ok: false, error: "نوع الملف غير مدعوم (صورة JPG/PNG/WebP أو PDF)" }, 400);
  if (!data || data.length > MAX_BASE64_CHARS) return json({ ok: false, error: "الملف فاضي أو كبير زيادة (الحد ~6 ميغا)" }, 400);

  // الطبقة المجانية بتنضغط بأوقات الذروة (503 "high demand") أو بتوصل حدها (429): بنعيد
  // المحاولة مرة، وبعدها نجرّب موديل أخف ببديل (حدوده ومزاحمته غير الموديل الأساسي)
  const primary = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
  const models = [...new Set([primary, "gemini-flash-lite-latest"])];
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
  let out: any = {};
  let lastStatus = 0;
  let lastMsg = "";
  let success = false;
  try {
    outer:
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
          }),
        });
        out = await r.json().catch(() => ({}));
        if (r.ok) { success = true; break outer; }
        lastStatus = r.status;
        lastMsg = out?.error?.message || `خطأ من Gemini (${r.status})`;
        if (r.status === 429) break; // حد هالموديل — نجرّب الموديل التاني مباشرة
        if ([500, 502, 503, 504].includes(r.status)) { if (attempt === 0) await sleep(1500); continue; }
        return json({ ok: false, error: lastMsg }, 502); // خطأ غير مؤقت (طلب مرفوض...)
      }
    }
    if (!success) {
      if (lastStatus === 429) return json({ ok: false, error: "وصلت الحد المجاني لقراءة الفواتير حاليًا — جرّب بعد دقيقة (أو بكرا) أو أدخلها يدويًا" }, 429);
      if ([500, 502, 503, 504].includes(lastStatus)) return json({ ok: false, error: "خدمة جوجل مضغوطة حاليًا (ضغط مؤقت على الخدمة المجانية) — جرّب بعد دقيقة أو دقيقتين، أو أدخل الفاتورة يدويًا" }, 503);
      return json({ ok: false, error: lastMsg || "فشلت قراءة الفاتورة" }, 502);
    }
    const text = out?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ ok: false, error: "ما قدر النموذج يقرأ الفاتورة — جرّب صورة أوضح" }, 422);
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ ok: false, error: "رد النموذج غير مفهوم — جرّب مرة ثانية" }, 502);
    }
    // تنظيف: أرقام صحيحة فقط، وحد أقصى للأصناف
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 150).map((it: any) => ({
      name: String(it?.name || "").trim().slice(0, 120),
      qty: num(it?.qty),
      unit: it?.unit ? String(it.unit).slice(0, 30) : null,
      unit_price: num(it?.unit_price),
      line_total: num(it?.line_total),
    })).filter((it: { name: string }) => it.name);
    return json({
      ok: true,
      invoice: {
        supplier_name: parsed.supplier_name ? String(parsed.supplier_name).slice(0, 120) : null,
        invoice_no: parsed.invoice_no ? String(parsed.invoice_no).slice(0, 60) : null,
        invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.invoice_date || "")) ? parsed.invoice_date : null,
        total: num(parsed.total),
        items,
      },
    });
  } catch (e) {
    return json({ ok: false, error: "تعذّر الاتصال بخدمة القراءة: " + (e as Error).message }, 502);
  }
});
