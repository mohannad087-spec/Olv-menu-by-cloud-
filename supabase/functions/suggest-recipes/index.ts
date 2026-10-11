// اقتراح وصفات للأصناف اللي ما إلها وصفة: الواجهة (product-recipes.html) بتبعت أرقام الأصناف،
// وهون منجيب أسماءها ومواد المخزون، ومنطلب من Gemini وصفة تقديرية لكل صنف من المواد الموجودة بس.
// ما بينحفظ شي هون: صاحب المطعم بيراجع الكميات وبيعدّلها وبعدين بيضغط «اعتماد».
//
// نفس مفتاح read-invoice و ai-assist: GEMINI_API_KEY (واختياري GEMINI_MODEL). للمالك والمدير فقط.
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

const MAX_PRODUCTS = 10;

// حد بسيط لكل مستخدم (بذاكرة نسخة الدالة): 6 طلبات بالدقيقة
const hits = new Map<string, number[]>();
function rateLimited(uid: string) {
  const now = Date.now();
  const list = (hits.get(uid) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(uid, list);
  return list.length > 6;
}

const PROMPT = `أنت شيف ومدير تكاليف بكافيه/مطعم بالأردن. بدنا وصفة تقديرية لكل صنف من أصناف المنيو تحت،
عشان النظام ينقّص المواد من المخزون مع كل بيعة ويحسب تكلفة الصنف وربحه.

القواعد:
- استخدم بس مواد من «قائمة المواد الموجودة»، وانسخ اسم المادة منها حرفيًا بـ ingredient.
- quantity = الكمية لكل وحدة بيع واحدة (كاسة/صحن/قطعة واحدة)، بنفس وحدة المادة بالقائمة.
  انتبه للتحويل: إذا وحدة المادة كيلوغرام و الصنف بياخد 18 غرام اكتب 0.018. إذا لتر و 200 مل اكتب 0.2.
  إذا الوحدة قطعة/علبة/كيس اكتب عدد القطع (مثلًا كاسة ورق واحدة = 1).
- كميات واقعية حسب الأحجام المعتادة بالسوق (إسبريسو دبل ~18 غرام بن، لاتيه ~200 مل حليب، ...). استعمل سعر البيع والوصف إذا بيساعدوا بتقدير الحجم.
- حط المستلزمات اللي بتنصرف مع الصنف إذا موجودة بالقائمة (كاسة، غطا، شلمونة، علبة سفري...).
- لا تكرر نفس المادة بنفس الصنف.
- missing: مواد أساسية للصنف مش موجودة بالقائمة (أسماء قصيرة)، حتى صاحب المطعم يضيفها للمخزون.
- confidence: "high" إذا الصنف واضح ووصفته معروفة، "medium" إذا في تخمين بالحجم، "low" إذا اسم الصنف مش واضح شو هو.
- note: جملة قصيرة جدًا بالعربي إذا في افتراض مهم (مثلًا "افترضت حجم وسط 12 أونصة")، وإلا null.
أرقام إنجليزية دايمًا.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    recipes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING" },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          note: { type: "STRING", nullable: true },
          lines: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { ingredient: { type: "STRING" }, quantity: { type: "NUMBER" } },
              required: ["ingredient", "quantity"],
            },
          },
          missing: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["key", "lines"],
      },
    },
  },
  required: ["recipes"],
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
    return json({ ok: false, error: "اقتراح الوصفات للمالك والمدير فقط" }, 403);
  }
  if (rateLimited(user.id)) return json({ ok: false, error: "طلبات كثيرة ورا بعض — استنى دقيقة وجرّب" }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح" }, 400);
  }
  const ids = (Array.isArray(body.product_ids) ? body.product_ids : [])
    .map((x) => String(x)).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_PRODUCTS);
  if (!ids.length) return json({ ok: false, error: "ما في أصناف مختارة" }, 400);

  const [pRes, iRes, uRes] = await Promise.all([
    admin.from("products").select("*").in("id", ids),
    admin.from("ingredients").select("id, name, unit").order("name").limit(3000),
    admin.from("supplies").select("id, name, unit").order("name").limit(3000),
  ]);
  if (pRes.error || iRes.error) return json({ ok: false, error: "تعذّر تحميل الأصناف أو المواد" }, 500);
  const products = pRes.data || [];
  const ingredients = iRes.data || [];
  if (!ingredients.length) return json({ ok: false, error: "ما في مواد خام بالمخزون لسا — ضيف المواد أول" }, 400);

  const clean = (s: unknown, n = 80) => String(s ?? "").replace(/[\n|<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  // المفتاح p1، p2... بدل رقم الصنف الطويل، أسهل على النموذج وما بيغلط فيه
  const keyed = products.map((p, i) => ({ key: "p" + (i + 1), p }));
  const productList = keyed.map(({ key, p }) =>
    `${key} | ${clean(p.name)} | قسم: ${clean(p.category)} | سعر: ${Number(p.price) || 0}${p.description ? " | " + clean(p.description, 160) : ""}`).join("\n");
  const ingList = ingredients.map((i) => `${clean(i.name)} | ${clean(i.unit, 20)}`).join("\n");
  // المستلزمات بتنعرض للمعلومة بس (الوصفة بتربط مواد خام فقط)
  const supList = (uRes.data || []).map((s) => clean(s.name)).join("، ").slice(0, 2000);

  const parts = [{
    text: `${PROMPT}\n\nقائمة المواد الموجودة (اسم | وحدة):\n${ingList}\n\n` +
      (supList ? `مستلزمات مسجّلة لحالها (مش مواد خام، لا تحطها بالوصفة إلا إذا موجودة بقائمة المواد فوق): ${supList}\n\n` : "") +
      `الأصناف (مفتاح | اسم | قسم | سعر | وصف):\n${productList}`,
  }];

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
            generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
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
      if (lastStatus === 429) return json({ ok: false, error: "وصلت الحد المجاني للذكاء الاصطناعي حاليًا — جرّب بعد دقيقة" }, 429);
      if ([500, 502, 503, 504].includes(lastStatus)) return json({ ok: false, error: "خدمة جوجل مضغوطة حاليًا — جرّب بعد دقيقة أو دقيقتين" }, 503);
      return json({ ok: false, error: lastMsg || "فشل الاقتراح" }, 502);
    }
    const outText = out?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outText) return json({ ok: false, error: "ما رجع النموذج اقتراحات — جرّب مرة ثانية" }, 422);
    let parsed: any;
    try {
      parsed = JSON.parse(outText);
    } catch {
      return json({ ok: false, error: "رد النموذج غير مفهوم — جرّب مرة ثانية" }, 502);
    }

    const byKey = new Map(keyed.map((k) => [k.key, k.p]));
    const byName = new Map(ingredients.map((i) => [norm(i.name), i]));
    const recipes = (Array.isArray(parsed.recipes) ? parsed.recipes : []).map((r: any) => {
      const p = byKey.get(String(r?.key || ""));
      if (!p) return null;
      const seen = new Set<string>();
      const lines: { ingredient_id: string; quantity: number; unsure: boolean }[] = [];
      const unmatched: string[] = [];
      (Array.isArray(r.lines) ? r.lines : []).slice(0, 25).forEach((l: any) => {
        const name = String(l?.ingredient || "");
        const qty = Number(l?.quantity);
        if (!name || !Number.isFinite(qty) || qty <= 0) return;
        let ing = byName.get(norm(name)) || null;
        let sure = !!ing;
        if (!ing) ({ item: ing, sure } = resolveItem(name, name, ingredients));
        if (!ing) { unmatched.push(clean(name, 60)); return; }
        if (seen.has(ing.id)) return;
        seen.add(ing.id);
        // كيلو أو لتر لصنف واحد غالبًا غلطة تحويل (غرام ↔ كيلو): منعلّمه حتى ينتبهله
        const big = /كيلو|لتر/.test(ing.unit) && !/مليلتر/.test(ing.unit) && qty > 1;
        lines.push({ ingredient_id: ing.id, quantity: Math.round(qty * 10000) / 10000, unsure: !sure || big });
      });
      const missing = [...new Set([...(Array.isArray(r.missing) ? r.missing : []).map((m: unknown) => clean(m, 60)), ...unmatched])]
        .filter(Boolean).slice(0, 8);
      return {
        product_id: p.id,
        confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium",
        note: r.note ? clean(r.note, 200) : null,
        lines,
        missing,
      };
    }).filter(Boolean);
    return json({ ok: true, recipes });
  } catch (e) {
    return json({ ok: false, error: "تعذّر الاتصال بخدمة الذكاء الاصطناعي: " + (e as Error).message }, 502);
  }
});
