// «المساعد الذكي» لصفحة بطاقة المادة (item-cards-ai.html). للمالك والمدير بس.
//   stats   { days }        ← مبيعات كل صنف بالفترة (كمية، إيراد، آخر بيعة) — بدون ذكاء، بس تجميع بصلاحية السيرفر
//   review  {}              ← Gemini بيقرأ البطاقات وبيدوّر على أخطاء محتملة (اسم، سعر غريب، ترجمة ناقصة...) ويقترح تصليح
//   insights { stats }      ← Gemini بيكتب ملاحظات قصيرة من أرقام التقرير
//   image   { product_id }  ← بيولّد صورة للصنف (موديل صور Gemini) وبيرفعها على تخزين Supabase (item-images) ويرجّع الرابط
// ما بينحفظ شي بالبطاقات هون: الصفحة بتعرض الاقتراح وصاحب المطعم بيعتمده.
// نفس مفتاح باقي دوال الذكاء: GEMINI_API_KEY (واختياري GEMINI_MODEL، و GEMINI_IMAGE_MODEL للصور).
import { createClient } from "npm:@supabase/supabase-js@2";
import { callGemini } from "../_shared/gemini.ts";

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

const BUCKET = "item-images";

// حد بسيط لكل مستخدم (بذاكرة نسخة الدالة): 12 طلب ذكاء بالدقيقة
const hits = new Map<string, number[]>();
function rateLimited(uid: string) {
  const now = Date.now();
  const list = (hits.get(uid) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(uid, list);
  return list.length > 12;
}

const clean = (s: unknown, n = 80) => String(s ?? "").replace(/[\n|<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

function aiError(ai: { status: number; message: string; timedOut: boolean }) {
  if (ai.status === 429) return json({ ok: false, error: "وصلت الحد المجاني للذكاء الاصطناعي حاليًا — جرّب بعد دقيقة" }, 429);
  if (ai.timedOut) return json({ ok: false, error: "خدمة جوجل طوّلت كتير وما ردّت — جرّب كمان مرة بعد شوي" }, 504);
  if ([500, 502, 503, 504].includes(ai.status)) return json({ ok: false, error: "خدمة جوجل مضغوطة حاليًا — جرّب بعد دقيقة أو دقيقتين" }, 503);
  if (ai.status === 422) return json({ ok: false, error: "ما قدر الذكاء الاصطناعي يطلع نتيجة — جرّب كمان مرة" }, 422);
  return json({ ok: false, error: ai.message || "فشل الذكاء الاصطناعي" }, 502);
}

const REVIEW_PROMPT = `أنت مدقق منيو بكافيه/مطعم بالأردن (العملة دينار، الأسعار عادةً بين 0.25 و 15).
تحت بطاقات أصناف المنيو. دوّر على الأخطاء المحتملة بس، وما تقترح تغيير لشي سليم:
- price: سعر شكله غلط مقارنة بأصناف شبهه بنفس القسم (مثلًا 35 بدل 3.5، أو صنف كبير أرخص من الصغير). اقترح السعر المعقول.
- hall_price: سعر صالة أقل من السعر العادي أو غريب جدًا.
- name: غلطة إملائية واضحة بالاسم العربي (اقترح الاسم المصحّح بنفس الصياغة).
- name_en: الاسم الإنجليزي فاضي أو غلط أو مش مطابق للعربي — اقترح اسم إنجليزي قصير ومناسب للمنيو.
- menu_cat: الصنف بقسم غلط واضح (اقترح رقم القسم الصح من قائمة الأقسام بالضبط).
- description: الوصف العربي فاضي لصنف مش واضح من اسمه — اقترح وصف قصير (أقل من 12 كلمة) بلهجة بسيطة. لا تخترع مكونات مش منطقية.
القواعد: key = مفتاح البطاقة حرفيًا. suggested = القيمة الجديدة كنص (للأسعار رقم بالإنجليزي). reason = جملة قصيرة جدًا بالعربي.
severity: "high" للأسعار الغلط الواضحة، "medium" للأقسام والأسماء، "low" للترجمة والوصف. أقصى شي 60 ملاحظة، الأهم أول.`;

const REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    issues: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING" },
          field: { type: "STRING", enum: ["price", "hall_price", "name", "name_en", "menu_cat", "description"] },
          suggested: { type: "STRING" },
          reason: { type: "STRING" },
          severity: { type: "STRING", enum: ["high", "medium", "low"] },
        },
        required: ["key", "field", "suggested", "reason"],
      },
    },
  },
  required: ["issues"],
};

const INSIGHTS_PROMPT = `أنت مستشار مطاعم. تحت أرقام مبيعات أصناف كافيه بالأردن لفترة محددة (كمية، إيراد بالدينار، وتكلفة المواد إذا معروفة).
اكتب من 4 لـ 7 ملاحظات عملية قصيرة بالعربي البسيط (لهجة شامية خفيفة)، كل وحدة جملة أو جملتين، مبنية على الأرقام بس:
مين الأصناف اللي بتشيل المبيعات، مين الراكدة وشو منعمل فيها، فرص رفع سعر أو عروض، أصناف ربحها قليل، وأي شي لافت.
لا تخترع أرقام مش موجودة. kind: "good" (شي ماشي منيح) أو "warn" (بدها انتباه) أو "idea" (اقتراح).`;

const INSIGHTS_SCHEMA = {
  type: "OBJECT",
  properties: {
    notes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { kind: { type: "STRING", enum: ["good", "warn", "idea"] }, text: { type: "STRING" } },
        required: ["kind", "text"],
      },
    },
  },
  required: ["notes"],
};

// deno-lint-ignore no-explicit-any
async function salesStats(admin: any, days: number) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const by: Record<string, { qty: number; revenue: number; last: string; orders: number }> = {};
  const voided = new Set<string>();
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await admin.from("sales_entries").select("id").eq("status", "voided").gte("created_at", since).range(from, from + 999);
    if (error) throw error;
    (data || []).forEach((r: { id: string }) => voided.add(r.id));
    if (!data || data.length < 1000) break;
  }
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await admin.from("sale_items")
      .select("sale_id, product_id, qty, unit_price, addons_total, status, created_at")
      .gte("created_at", since).order("created_at").range(from, from + 999);
    if (error) throw error;
    (data || []).forEach((r: { sale_id: string; product_id: string | null; qty: number; unit_price: number; addons_total: number | null; status: string | null; created_at: string }) => {
      if (!r.product_id || r.status === "voided" || voided.has(r.sale_id)) return;
      const q = Number(r.qty) || 0;
      const s = by[r.product_id] || (by[r.product_id] = { qty: 0, revenue: 0, last: "", orders: 0 });
      s.qty += q;
      s.revenue += q * ((Number(r.unit_price) || 0) + (Number(r.addons_total) || 0));
      s.orders += 1;
      if (r.created_at > s.last) s.last = r.created_at;
    });
    if (!data || data.length < 1000) break;
  }
  Object.values(by).forEach((s) => { s.revenue = Math.round(s.revenue * 100) / 100; s.qty = Math.round(s.qty * 100) / 100; });
  return by;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "إعدادات Supabase ناقصة بالسيرفر" }, 500);

  const authHeader = req.headers.get("authorization") || "";
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: "جلسة غير صالحة" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile } = await admin.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile || profile.is_active === false || !["owner", "manager"].includes(profile.role)) {
    return json({ ok: false, error: "المساعد الذكي للمالك والمدير فقط" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح" }, 400);
  }

  try {
    if (body.action === "stats") {
      const days = Math.min(365, Math.max(1, Math.round(Number(body.days) || 30)));
      return json({ ok: true, days, stats: await salesStats(admin, days) });
    }

    if (!GEMINI_KEY) return json({ ok: false, error: "GEMINI_API_KEY غير مضبوط بأسرار Edge Functions" }, 500);
    if (rateLimited(user.id)) return json({ ok: false, error: "طلبات كثيرة ورا بعض — استنى دقيقة وجرّب" }, 429);

    if (body.action === "review") {
      const [pRes, mRes] = await Promise.all([
        admin.from("products").select("id, external_id, name, name_en, description, menu_cat, category, price, hall_price, meal_price, is_active")
          .eq("is_active", true).not("external_id", "is", null).order("sort_order").limit(500),
        fetch("https://olv-menu.pages.dev/data/menu.json", { headers: { "cache-control": "no-cache" } }).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (pRes.error) return json({ ok: false, error: pRes.error.message }, 500);
      const cards = (pRes.data || []).filter((p) => !String(p.external_id).startsWith("stk-"));
      if (!cards.length) return json({ ok: true, issues: [] });
      const cats: { id: string; ar: string }[] = ((mRes && mRes.categories) || []).map((c: { id: string; ar: string }) => ({ id: c.id, ar: c.ar }));
      const keyed = cards.map((p, i) => ({ key: "c" + (i + 1), p }));
      const list = keyed.map(({ key, p }) => [
        key, clean(p.name), "en: " + (clean(p.name_en) || "—"), "قسم: " + (p.menu_cat || "—"),
        "سعر: " + Number(p.price), p.hall_price ? "صالة: " + Number(p.hall_price) : "", p.meal_price ? "وجبة: " + Number(p.meal_price) : "",
        "وصف: " + (clean(p.description, 120) || "—"),
      ].filter(Boolean).join(" | ")).join("\n");
      const catList = cats.map((c) => `${c.id} = ${clean(c.ar)}`).join("\n");
      const ai = await callGemini(GEMINI_KEY, [{ text: `${REVIEW_PROMPT}\n\nالأقسام (رقم = اسم):\n${catList}\n\nالبطاقات:\n${list}` }],
        { temperature: 0.1, responseMimeType: "application/json", responseSchema: REVIEW_SCHEMA }, { tag: "item-cards-review" });
      if (!ai.ok) return aiError(ai);
      // deno-lint-ignore no-explicit-any
      let parsed: any;
      try { parsed = JSON.parse(ai.text); } catch { return json({ ok: false, error: "رد النموذج غير مفهوم — جرّب مرة ثانية" }, 502); }
      const byKey = new Map(keyed.map((k) => [k.key, k.p]));
      const catIds = new Set(cats.map((c) => c.id));
      const seen = new Set<string>();
      // deno-lint-ignore no-explicit-any
      const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).map((x: any) => {
        const p = byKey.get(String(x?.key || ""));
        if (!p) return null;
        const field = String(x.field);
        let suggested: string | number = clean(x.suggested, 160);
        if (!suggested) return null;
        if (field === "price" || field === "hall_price") {
          const n = Number(suggested);
          if (!(n > 0) || n > 500) return null;
          suggested = Math.round(n * 100) / 100;
          if (field === "price" && suggested === Number(p.price)) return null;
          if (field === "hall_price" && suggested === Number(p.hall_price)) return null;
        }
        if (field === "menu_cat" && (!catIds.has(String(suggested)) || suggested === p.menu_cat)) return null;
        const cur = { name: p.name, name_en: p.name_en, description: p.description, menu_cat: p.menu_cat, price: p.price, hall_price: p.hall_price }[field];
        if (typeof suggested === "string" && suggested === String(cur ?? "")) return null;
        const id = p.id + ":" + field;
        if (seen.has(id)) return null;
        seen.add(id);
        return { product_id: p.id, field, current: cur ?? null, suggested, reason: clean(x.reason, 200), severity: ["high", "medium", "low"].includes(x.severity) ? x.severity : "low" };
      }).filter(Boolean);
      return json({ ok: true, issues, categories: cats });
    }

    if (body.action === "insights") {
      const rows = (Array.isArray(body.stats) ? body.stats : []).slice(0, 120).map((r: Record<string, unknown>) =>
        `${clean(r.name)} | قسم: ${clean(r.cat, 40)} | كمية: ${Number(r.qty) || 0} | إيراد: ${Number(r.revenue) || 0}` +
        (Number(r.costPct) > 0 ? ` | تكلفة المواد ${Math.round(Number(r.costPct))}% من السعر` : "") + ` | السعر ${Number(r.price) || 0}`).join("\n");
      if (!rows) return json({ ok: false, error: "ما في أرقام للتحليل" }, 400);
      const days = Math.round(Number(body.days) || 30);
      const ai = await callGemini(GEMINI_KEY, [{ text: `${INSIGHTS_PROMPT}\n\nالفترة: آخر ${days} يوم.\n${rows}` }],
        { temperature: 0.3, responseMimeType: "application/json", responseSchema: INSIGHTS_SCHEMA }, { tag: "item-cards-insights" });
      if (!ai.ok) return aiError(ai);
      // deno-lint-ignore no-explicit-any
      let parsed: any;
      try { parsed = JSON.parse(ai.text); } catch { return json({ ok: false, error: "رد النموذج غير مفهوم — جرّب مرة ثانية" }, 502); }
      // deno-lint-ignore no-explicit-any
      const notes = (Array.isArray(parsed.notes) ? parsed.notes : []).slice(0, 8).map((n: any) => ({
        kind: ["good", "warn", "idea"].includes(n?.kind) ? n.kind : "idea", text: clean(n?.text, 400),
      })).filter((n: { text: string }) => n.text);
      return json({ ok: true, notes });
    }

    if (body.action === "image") {
      const id = String(body.product_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "صنف غير صالح" }, 400);
      const { data: p, error: pe } = await admin.from("products").select("id, external_id, name, name_en, description, category").eq("id", id).single();
      if (pe || !p) return json({ ok: false, error: "الصنف مش موجود" }, 404);
      const model = Deno.env.get("GEMINI_IMAGE_MODEL") || "gemini-2.5-flash-image";
      const prompt = `Professional appetizing food/drink photo for a cafe menu in Jordan. Item: "${clean(p.name_en) || clean(p.name)}" (Arabic name: ${clean(p.name)}; category: ${clean(p.category, 40)}${p.description ? "; description: " + clean(p.description, 160) : ""}).
Show exactly this item as it is usually served, single serving, centered, 45-degree angle, soft natural light, warm cream/neutral background, shallow depth of field, realistic, square 1:1.
No text, no letters, no logos, no watermark, no hands.`;
      let r: Response;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch {
        return json({ ok: false, error: "خدمة جوجل طوّلت كتير وما ردّت — جرّب كمان مرة" }, 504);
      }
      // deno-lint-ignore no-explicit-any
      const out: any = await r.json().catch(() => ({}));
      console.log(JSON.stringify({ tag: "item-cards-image", model, status: r.status, err: r.ok ? undefined : out?.error?.message?.slice(0, 200) }));
      if (!r.ok) {
        if (r.status === 429) return json({ ok: false, error: "حساب Gemini الحالي ما بيسمح بتوليد صور (الحد المجاني للصور صفر أو خلص). لتشغيلها لازم تفعيل الفوترة على مفتاح Gemini" }, 429);
        return json({ ok: false, error: "فشل توليد الصورة: " + (out?.error?.message || r.status) }, 502);
      }
      // deno-lint-ignore no-explicit-any
      const part = (out?.candidates?.[0]?.content?.parts || []).find((x: any) => x?.inlineData?.data || x?.inline_data?.data);
      const inline = part?.inlineData || part?.inline_data;
      if (!inline) return json({ ok: false, error: "ما رجعت صورة — جرّب كمان مرة" }, 422);
      const mime = String(inline.mimeType || inline.mime_type || "image/png");
      const bytes = Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0));
      // مخزن الصور العام: بينعمل لحاله أول مرة (نفس schema-item-images.sql)
      const { data: bucket } = await admin.storage.getBucket(BUCKET);
      if (!bucket) {
        const { error: be } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] });
        if (be && !/exist/i.test(be.message)) return json({ ok: false, error: "تعذّر تجهيز مخزن الصور: " + be.message }, 500);
      }
      const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
      const path = `${String(p.external_id || p.id).replace(/[^a-z0-9_-]/gi, "_")}-${Date.now().toString(36)}.${ext}`;
      const { error: ue } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "604800" });
      if (ue) return json({ ok: false, error: "تعذّر رفع الصورة: " + ue.message }, 500);
      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
      return json({ ok: true, url: pub.publicUrl, path });
    }

    // صورة مقترحة انرفضت: منشيلها من المخزن حتى ما يتعبّى (بس ملفات هالمخزن)
    if (body.action === "discard_image") {
      const path = String(body.path || "");
      if (!/^[a-z0-9_-]+\.(png|jpg|webp)$/i.test(path)) return json({ ok: false, error: "مسار غير صالح" }, 400);
      await admin.storage.from(BUCKET).remove([path]);
      return json({ ok: true });
    }

    return json({ ok: false, error: "action غير معروف (stats أو review أو insights أو image أو discard_image)" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "خطأ بالسيرفر" }, 500);
  }
});
