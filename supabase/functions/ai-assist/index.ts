// إضافة مواد ومستلزمات وموردين وبطاقات منيو بالذكاء الاصطناعي: نص (قائمة أسعار مورّد، رسالة
// واتساب، جرد مكتوب) أو صورة (فاتورة، ورقة، كتالوج) → اقتراحات منظّمة. الواجهة (assets/ai-assist.js)
// بتعرضها للمراجعة والتعديل، وما بينحفظ شي إلا بعد ما المستخدم يضغط «إضافة المحدد».
//
// نفس مفتاح read-invoice: GEMINI_API_KEY (واختياري GEMINI_MODEL) بأسرار Edge Functions.
// للمالك والمدير فقط. المواد والموردين الموجودين بينقروا من السيرفر حتى ما يتكرروا.
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

const UNITS = ["كيلوغرام", "غرام", "لتر", "مليلتر", "قطعة", "علبة", "كيس", "زجاجة", "عبوة", "رول", "حزمة"];

const PROMPT = `أنت مساعد مخزون لمطعم/كافيه. المرفق نص أو صورة فيها مواد و/أو موردين: قائمة أسعار مورّد، رسالة واتساب،
فاتورة، جرد مكتوب، كتالوج، أو طلب صريح مثل "ضيف مورّد اسمه أبو سامر 0791234567" أو "اعمل بطاقة مشروب غازي فيها كولا وسبرايت".
استخرج اقتراحات منظّمة:

suppliers: الموردين المذكورين (name، phone إن وُجد بأرقام إنجليزية، notes قصيرة إن وُجدت). إذا المورّد موجود أصلًا بقائمة الموردين ضع اسمه منسوخ حرفيًا من القائمة بـ existing، وإلا null.

materials: كل مادة أو مستلزم مذكور:
- name: اسم واضح ومرتّب بالعربي كما يُستخدم بالمطعم (مثلًا "حليب كامل الدسم" بدل "حليب ك.د")، بدون الكمية أو السعر.
- existing: إذا المادة نفسها موجودة بقائمة المواد ضع اسمها منسوخ حرفيًا من القائمة — لازم تكون نفس المادة بالضبط (نفس النكهة والحجم)، لا تخمّن، وإلا null.
- kind: "ingredient" لمواد الأكل والشرب والبضاعة، "supply" للمستلزمات (أكواب، أكياس، مناديل، منظفات، فحم...).
- unit: وحدة المخزون، واحدة من: ${UNITS.join("، ")}.
- purchase_unit و purchase_factor: إذا بتنشرى بعبوة أكبر (كرتونة 24 علبة، صندوق 10 كيلو) اكتب اسمها وكم وحدة مخزون فيها، وإلا null.
- stock: الكمية الموجودة حاليًا إذا النص جرد أو بيذكر الكمية الموجودة، وإلا null (كميات الطلب أو الشراء مش مخزون).
- price و price_per: السعر إذا مكتوب، و price_per = "purchase" إذا السعر للعبوة الكبيرة أو "stock" إذا لوحدة المخزون.
- supplier: اسم المورّد (من الموردين الموجودين منسوخ حرفيًا، أو مورّد جديد من suppliers) إذا المادة منه، وإلا null.
- card و variant: فقط إذا المستخدم طلب بطاقة منيو أو المواد واضح إنها أنواع لنفس الصنف المعروض (مثلًا بطاقة "مشروب غازي علبة 330 مل" وأنواعها كولا، سبرايت). card = اسم البطاقة، variant = اسم النوع داخلها. البطاقات للمواد (ingredient) بس. وإلا null.

أرقام إنجليزية دايمًا. لا تخترع أشياء مش موجودة بالنص أو الصورة، ولا تكرر نفس المادة.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    suppliers: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          phone: { type: "STRING", nullable: true },
          notes: { type: "STRING", nullable: true },
          existing: { type: "STRING", nullable: true },
        },
        required: ["name"],
      },
    },
    materials: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          existing: { type: "STRING", nullable: true },
          kind: { type: "STRING", enum: ["ingredient", "supply"] },
          unit: { type: "STRING", enum: UNITS },
          purchase_unit: { type: "STRING", nullable: true },
          purchase_factor: { type: "NUMBER", nullable: true },
          stock: { type: "NUMBER", nullable: true },
          price: { type: "NUMBER", nullable: true },
          price_per: { type: "STRING", enum: ["purchase", "stock"], nullable: true },
          supplier: { type: "STRING", nullable: true },
          card: { type: "STRING", nullable: true },
          variant: { type: "STRING", nullable: true },
        },
        required: ["name", "kind", "unit"],
      },
    },
  },
  required: ["suppliers", "materials"],
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
    return json({ ok: false, error: "الإضافة بالذكاء الاصطناعي للمالك والمدير فقط" }, 403);
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
  if (!text && !data) return json({ ok: false, error: "اكتب أو الصق النص، أو اختر صورة" }, 400);
  if (data) {
    if (!ALLOWED_MIME.has(mime)) return json({ ok: false, error: "نوع الملف غير مدعوم (صورة JPG/PNG/WebP أو PDF)" }, 400);
    if (data.length > MAX_BASE64_CHARS) return json({ ok: false, error: "الملف كبير زيادة (الحد ~6 ميغا)" }, 400);
  }

  // المواد والموردين والبطاقات الموجودة بأسمائها، حتى ما يتكرروا
  const [iRes, uRes, sRes] = await Promise.all([
    admin.from("ingredients").select("id, name, unit, menu_group").order("name").limit(3000),
    admin.from("supplies").select("id, name, unit").order("name").limit(3000),
    admin.from("suppliers").select("id, name, phone").order("name").limit(500),
  ]);
  if (iRes.error || uRes.error || sRes.error) return json({ ok: false, error: "تعذّر تحميل المواد" }, 500);
  const items = [
    ...(iRes.data || []).map((r) => ({ key: "ingredient:" + r.id, name: r.name, unit: r.unit })),
    ...(uRes.data || []).map((r) => ({ key: "supply:" + r.id, name: r.name, unit: r.unit })),
  ];
  const suppliers = sRes.data || [];
  const cards = [...new Set((iRes.data || []).map((r) => r.menu_group).filter(Boolean))];
  const clean = (s: string) => String(s || "").replace(/[\n|]/g, " ").slice(0, 80);
  const itemList = items.map((it) => `${clean(it.name)} | ${clean(it.unit)}`).join("\n") || "(ما في)";
  const supList = suppliers.map((s) => clean(s.name)).join("\n") || "(ما في)";
  const cardList = cards.map(clean).join("\n") || "(ما في)";

  const parts: unknown[] = [
    { text: `${PROMPT}\n\nقائمة المواد الموجودة (اسم | وحدة):\n${itemList}\n\nالموردين الموجودين:\n${supList}\n\nبطاقات المنيو الموجودة:\n${cardList}` },
  ];
  if (text) parts.push({ text: "النص:\n<<<\n" + text + "\n>>>" });
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
      if (lastStatus === 429) return json({ ok: false, error: "وصلت الحد المجاني للذكاء الاصطناعي حاليًا — جرّب بعد دقيقة أو أضف يدويًا" }, 429);
      if ([500, 502, 503, 504].includes(lastStatus)) return json({ ok: false, error: "خدمة جوجل مضغوطة حاليًا — جرّب بعد دقيقة أو دقيقتين" }, 503);
      return json({ ok: false, error: lastMsg || "فشل التحليل" }, 502);
    }
    const outText = out?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outText) return json({ ok: false, error: "ما قدر النموذج يقرأ المحتوى — جرّب نص أوضح أو صورة أوضح" }, 422);
    let parsed: any;
    try {
      parsed = JSON.parse(outText);
    } catch {
      return json({ ok: false, error: "رد النموذج غير مفهوم — جرّب مرة ثانية" }, 502);
    }
    const supByName = new Map(suppliers.map((x) => [norm(x.name), x]));
    const findSupplier = (v: unknown) => supByName.get(norm(String(v || ""))) || null;
    const str = (v: unknown, n: number) => (v == null ? null : String(v).replace(/\s+/g, " ").trim().slice(0, n) || null);
    const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
    const outSup = (Array.isArray(parsed.suppliers) ? parsed.suppliers : []).slice(0, 50).map((s: any) => {
      const ex = findSupplier(s?.existing) || findSupplier(s?.name);
      return {
        name: str(s?.name, 120),
        phone: str(s?.phone, 30),
        notes: str(s?.notes, 300),
        existing_id: ex ? ex.id : null,
      };
    }).filter((s: { name: string | null }) => s.name);
    const outMat = (Array.isArray(parsed.materials) ? parsed.materials : []).slice(0, 200).map((m: any) => {
      // «موجود» بس إذا الاسم مطابق أو التطابق أكيد — غير هيك منعتبرها مادة جديدة والمستخدم بيقرر
      const { item: ex, sure } = resolveItem(m?.existing ? String(m.existing) : null, String(m?.name || ""), items);
      const sup = findSupplier(m?.supplier);
      const pu = str(m?.purchase_unit, 30), pf = pos(m?.purchase_factor);
      return {
        name: str(m?.name, 120),
        existing_key: ex && (sure || norm(ex.name) === norm(String(m?.name || ""))) ? ex.key : null,
        kind: m?.kind === "supply" ? "supply" : "ingredient",
        unit: UNITS.includes(m?.unit) ? m.unit : "قطعة",
        purchase_unit: pu && pf ? pu : null,
        purchase_factor: pu && pf ? pf : null,
        stock: typeof m?.stock === "number" && Number.isFinite(m.stock) && m.stock >= 0 ? m.stock : null,
        price: pos(m?.price),
        price_per: m?.price_per === "purchase" && pu && pf ? "purchase" : "stock",
        supplier_id: sup ? sup.id : null,
        supplier_name: sup ? null : str(m?.supplier, 120),
        card: str(m?.card, 80),
        variant: str(m?.variant, 80),
      };
    }).filter((m: { name: string | null }) => m.name);
    return json({ ok: true, suppliers: outSup, materials: outMat });
  } catch (e) {
    return json({ ok: false, error: "تعذّر الاتصال بخدمة الذكاء الاصطناعي: " + (e as Error).message }, 502);
  }
});
