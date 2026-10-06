// تجهيز طلبية بالذكاء الاصطناعي: نص من واتساب أو صورة (ورقة بخط اليد، سكرين شوت، فاتورة)
// بيتحوّل لسطور طلبية مربوطة بمواد المخزون الموجودة، ولكل سطر المورّد المقترح.
// الواجهة (purchase-orders.html) بتعرضها مقسّمة حسب المورّد، وصاحب المطعم بيراجع
// ويعدّل قبل ما ينقلها للطلبية — الدالة ما بتحفظ شي، وما بتنشئ مواد جديدة أبدًا.
//
// نفس مفتاح read-invoice: GEMINI_API_KEY (واختياري GEMINI_MODEL) بأسرار Edge Functions.
// للمالك والمدير فقط. قائمة المواد والموردين بتنقرا من السيرفر (مش من المتصفح).
import { createClient } from "npm:@supabase/supabase-js@2";
import { norm, resolveItem } from "../_shared/match.ts";

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
const MAX_BASE64_CHARS = 8_000_000;
const MAX_TEXT = 6000;

// حد بسيط لكل مستخدم (بذاكرة نسخة الدالة): 8 طلبات بالدقيقة
const hits = new Map<string, number[]>();
function rateLimited(uid: string) {
  const now = Date.now();
  const list = (hits.get(uid) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(uid, list);
  return list.length > 8;
}

const PROMPT = `أنت مساعد مشتريات لمطعم/كافيه. المرفق طلبية مواد: نص منسوخ من واتساب، أو صورة (ورقة بخط اليد، سكرين شوت محادثة، فاتورة قديمة).
استخرج كل صنف مطلوب مع الكمية، واربطه بمادة من «قائمة المواد» تحت.

القواعد:
- لكل صنف: raw = النص كما هو مكتوب، qty = الكمية رقمًا (أرقام إنجليزية، نصف = 0.5، ربع = 0.25، "كيلو ونص" = 1.5). إذا ما في كمية مكتوبة ضع null.
- item = اسم المادة من «قائمة المواد» منسوخ حرفيًا كما هو بالقائمة (انتبه للمرادفات واللهجة والأخطاء الإملائية والإنجليزي).
  كثير مواد متشابهة (مثلًا نكهات معسل كثيرة): اختر المادة اللي كل كلماتها المميزة مذكورة بالسطر، مش أقرب اسم. «علكة نعناع» ≠ «علكة»، و«ليمون نعناع» ≠ «ليمون».
  إذا مش متأكد أو مش موجودة ضع null — لا تخمّن.
- unit = "purchase" إذا الكمية بوحدة الشراء المذكورة للمادة (كرتونة، صندوق...)، أو "stock" إذا بوحدة المخزون (كيلو، قطعة...). إذا الوحدة المكتوبة غير هيك أو مش واضحة اختر الأقرب، واكتب الوحدة كما هي بـ unit_raw.
- supplier = اسم المورّد من «الموردين» منسوخ حرفيًا، فقط إذا النص يذكر المورّد صراحة لهذا الصنف أو لمجموعة أصناف (مثلاً عنوان "من أبو أحمد:")، وإلا null.
- تجاهل التحيات والكلام العام والأسعار والمجاميع. لا تدمج صنفين ولا تخترع أصنافًا.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          raw: { type: "STRING" },
          qty: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", enum: ["purchase", "stock"], nullable: true },
          unit_raw: { type: "STRING", nullable: true },
          item: { type: "STRING", nullable: true },
          supplier: { type: "STRING", nullable: true },
        },
        required: ["raw"],
      },
    },
  },
  required: ["lines"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "إعدادات Supabase ناقصة بالسيرفر" }, 500);
  if (!GEMINI_KEY) return json({ ok: false, error: "GEMINI_API_KEY غير مضبوط بأسرار Edge Functions" }, 500);

  const authHeader = req.headers.get("authorization") || "";
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: "جلسة غير صالحة" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile } = await admin.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile || profile.is_active === false || !["owner", "manager"].includes(profile.role)) {
    return json({ ok: false, error: "تجهيز الطلبيات للمالك والمدير فقط" }, 403);
  }
  if (rateLimited(user.id)) return json({ ok: false, error: "طلبات كثيرة ورا بعض — استنى دقيقة وجرّب" }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح" }, 400);
  }
  const text = String(body.text || "").trim().slice(0, MAX_TEXT);
  const mime = body.mime_type ? String(body.mime_type) : "";
  const data = body.data ? String(body.data) : "";
  if (!text && !data) return json({ ok: false, error: "الصق نص الطلبية أو اختر صورة" }, 400);
  if (data) {
    if (!ALLOWED_MIME.has(mime)) return json({ ok: false, error: "نوع الملف غير مدعوم (صورة JPG/PNG/WebP أو PDF)" }, 400);
    if (data.length > MAX_BASE64_CHARS) return json({ ok: false, error: "الملف كبير زيادة (الحد ~6 ميغا)" }, 400);
  }

  // المواد والموردين من القاعدة
  const [iRes, uRes, sRes] = await Promise.all([
    admin.from("ingredients").select("id, name, unit, purchase_unit, purchase_unit_factor").order("name").limit(3000),
    admin.from("supplies").select("id, name, unit, purchase_unit, purchase_unit_factor").order("name").limit(3000),
    admin.from("suppliers").select("id, name").order("name").limit(500),
  ]);
  if (iRes.error || uRes.error || sRes.error) return json({ ok: false, error: "تعذّر تحميل المواد" }, 500);
  type Item = { key: string; name: string; unit: string; pu: string | null; pf: number };
  const items: Item[] = [
    ...(iRes.data || []).map((r) => ({ key: "ingredient:" + r.id, name: r.name, unit: r.unit, pu: r.purchase_unit, pf: Number(r.purchase_unit_factor) || 0 })),
    ...(uRes.data || []).map((r) => ({ key: "supply:" + r.id, name: r.name, unit: r.unit, pu: r.purchase_unit, pf: Number(r.purchase_unit_factor) || 0 })),
  ];
  if (!items.length) return json({ ok: false, error: "ما في مواد بالمخزون لسا — أضف موادك أولًا" }, 422);
  const suppliers = sRes.data || [];
  const clean = (s: string) => String(s || "").replace(/[\n|]/g, " ").slice(0, 80);
  // أسماء بدل رموز (i12): الرموز المتجاورة لمواد متشابهة (نكهات المعسل مثلًا) سهل تنلخبط، والاسم بنتحقق منه هون
  const itemList = items.map((it) => `${clean(it.name)} | ${clean(it.unit)}${it.pu && it.pf > 0 ? ` | وحدة شراء: ${clean(it.pu)} = ${it.pf} ${clean(it.unit)}` : ""}`).join("\n");
  const supList = suppliers.map((s) => clean(s.name)).join("\n") || "(ما في)";

  const parts: unknown[] = [
    { text: `${PROMPT}\n\nقائمة المواد (اسم | وحدة المخزون | وحدة الشراء):\n${itemList}\n\nالموردين:\n${supList}` },
  ];
  if (text) parts.push({ text: "نص الطلبية:\n<<<\n" + text + "\n>>>" });
  if (data) parts.push({ inline_data: { mime_type: mime, data } });

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
            contents: [{ parts }],
            generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
          }),
        });
        out = await r.json().catch(() => ({}));
        if (r.ok) { success = true; break outer; }
        lastStatus = r.status;
        lastMsg = out?.error?.message || `خطأ من Gemini (${r.status})`;
        if (r.status === 429) break;
        if ([500, 502, 503, 504].includes(r.status)) { if (attempt === 0) await sleep(1500); continue; }
        return json({ ok: false, error: lastMsg }, 502);
      }
    }
    if (!success) {
      if (lastStatus === 429) return json({ ok: false, error: "وصلت الحد المجاني للذكاء الاصطناعي حاليًا — جرّب بعد دقيقة أو جهّز الطلبية يدويًا" }, 429);
      if ([500, 502, 503, 504].includes(lastStatus)) return json({ ok: false, error: "خدمة جوجل مضغوطة حاليًا — جرّب بعد دقيقة أو دقيقتين" }, 503);
      return json({ ok: false, error: lastMsg || "فشل تحليل الطلبية" }, 502);
    }
    const outText = out?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outText) return json({ ok: false, error: "ما قدر النموذج يقرأ الطلبية — جرّب نص أوضح أو صورة أوضح" }, 422);
    let parsed: any;
    try {
      parsed = JSON.parse(outText);
    } catch {
      return json({ ok: false, error: "رد النموذج غير مفهوم — جرّب مرة ثانية" }, 502);
    }
    const supByName = new Map(suppliers.map((x) => [norm(x.name), x]));
    const findSupplier = (v: unknown) => {
      const n = norm(String(v || ""));
      if (n.length < 3) return null;
      return supByName.get(n) || suppliers.find((x) => norm(x.name).includes(n) || n.includes(norm(x.name))) || null;
    };
    const lines = (Array.isArray(parsed.lines) ? parsed.lines : []).slice(0, 150).map((l: any) => {
      const raw = String(l?.raw || "").trim().slice(0, 160);
      const { item, sure } = resolveItem(l?.item ? String(l.item) : null, raw, items);
      const sup = findSupplier(l?.supplier);
      const qty = typeof l?.qty === "number" && Number.isFinite(l.qty) && l.qty > 0 ? l.qty : null;
      return {
        raw,
        qty,
        unit: l?.unit === "purchase" || l?.unit === "stock" ? l.unit : null,
        unit_raw: l?.unit_raw ? String(l.unit_raw).slice(0, 30) : null,
        item_key: item ? item.key : null,
        sure: !!item && sure,
        supplier_id: sup ? sup.id : null,
      };
    }).filter((l: { raw: string }) => l.raw);
    return json({ ok: true, lines });
  } catch (e) {
    return json({ ok: false, error: "تعذّر الاتصال بخدمة الذكاء الاصطناعي: " + (e as Error).message }, 502);
  }
});
