// وسيط آمن بين نظام المحاسبة وموقع المنيو الحقيقي (olv-menu.pages.dev، منشور على Cloudflare Pages).
//
// Supabase تتحقق من تسجيل دخول المستخدم (Bearer token) تلقائيًا قبل ما
// توصّل الطلب لهون — طالما الدالة منشورة بإعداداتها الافتراضية (بدون
// تعطيل verify_jwt). المفتاح الإداري لموقع المنيو (OLV_ADMIN_KEY) محفوظ
// كسر بجانب السيرفر فقط عبر Deno.env، وما بينكشف أبدًا لكود المتصفح —
// هذا هو سبب وجود هذا الوسيط بدل ما تتواصل صفحة المحاسبة مباشرة مع موقع
// المنيو (يلي كمان ما فيه إعدادات CORS تسمح بذلك أصلًا).
//
// verify_jwt لحالها بتقبل أي حساب مسجّل، حتى لو موقوف — فبنتأكد كمان إن
// المستدعي إله ملف (profile) مفعّل قبل ما نكشف أرقام وعناوين الزباين.

import { createClient } from "npm:@supabase/supabase-js@2";

const OLV_MENU_API = "https://olv-menu.pages.dev/api/orders";
const OLV_CONTROLS_API = "https://olv-menu.pages.dev/api/controls";
const OLV_STOCK_SYNC_API = "https://olv-menu.pages.dev/api/stock-sync";
const OLV_SITE = "https://olv-menu.pages.dev";
const OLV_MENU_JSON = "https://olv-menu.pages.dev/data/menu.json";

// رابط تشغيل موقّع لصفحات الإدارة/الموظفين بموقع المنيو (بوابة functions/_go.js هناك بتتحقق منه).
// نفس صيغة functions/_lib/gate.js: HMAC-SHA256(OLV_ADMIN_KEY, "olv-gate|go|<scope>|<exp>"). صلاحية رابط الإدارة 10 دقايق، ورابط الموظفين 14 يوم.
async function launchLink(adminKey: string, scope: "admin" | "staff", to: string) {
  const exp = Math.floor(Date.now() / 1000) + (scope === "admin" ? 600 : 14 * 86400);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(adminKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`olv-gate|go|${scope}|${exp}`))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const page = /^\/[a-z-]+\.html$/.test(to) ? to : (scope === "admin" ? "/admin.html" : "/waiter.html");
  return `${OLV_SITE}/_go?t=${scope}.${exp}.${sig}&to=${encodeURIComponent(page)}`;
}

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

// «طلبك جاهز» على واتساب تلقائي عبر WhatsApp Cloud API (Meta). بيشتغل بس لما تنضاف الأسرار:
// WHATSAPP_TOKEN و WHATSAPP_PHONE_ID (واختياري WHATSAPP_TEMPLATE، الافتراضي order_ready، و WHATSAPP_LANG، الافتراضي ar).
// القالب لازم يكون موافق عليه من Meta وفيه متغيرين: {{1}} رقم الطلب و {{2}} مكان الاستلام.
// الكاشير والمطبخ ممكن يبلّغوا نفس الطلب سوا، فجدول menu_whatsapp_log بيضمن رسالة وحدة لكل طلب.
// deno-lint-ignore no-explicit-any
async function sendWhatsAppReady(admin: any, orderId: string, body: Record<string, unknown>) {
  const token = (Deno.env.get("WHATSAPP_TOKEN") || "").trim();
  const phoneId = (Deno.env.get("WHATSAPP_PHONE_ID") || "").trim();
  if (!token || !phoneId) return { sent: false, reason: "not_configured" };
  const to = String(body.wa_phone || "").replace(/[^\d]/g, "");
  if (to.length < 10 || to.length > 15) return { sent: false, reason: "bad_phone" };
  const { error: claimErr } = await admin.from("menu_whatsapp_log").insert({ order_id: orderId, phone: to });
  if (claimErr) return { sent: false, reason: claimErr.code === "23505" ? "already_sent" : claimErr.message };
  const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n) || "-";
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: Deno.env.get("WHATSAPP_TEMPLATE") || "order_ready",
          language: { code: Deno.env.get("WHATSAPP_LANG") || "ar" },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: clip(body.wa_number, 20) },
              { type: "text", text: clip(body.wa_where, 120) },
            ],
          }],
        },
      }),
    });
    const out = await r.json().catch(() => ({}));
    const err = r.ok ? null : clip(out?.error?.message || ("HTTP " + r.status), 300);
    await admin.from("menu_whatsapp_log").update({ ok: r.ok, error: err }).eq("order_id", orderId);
    return r.ok ? { sent: true } : { sent: false, reason: err };
  } catch (e) {
    const err = e instanceof Error ? e.message : "fetch failed";
    await admin.from("menu_whatsapp_log").update({ ok: false, error: err }).eq("order_id", orderId);
    return { sent: false, reason: err };
  }
}

// يقرأ رد موقع المنيو كنص أول، فإذا رجع صفحة HTML (خطأ من Cloudflare مثلًا) ما بنكسر على r.json():
// بنسجّل الحالة وبداية الصفحة بسجلات الدالة ونرجّع 502 برسالة فيها السبب الحقيقي. فحص "list" (قراءة فقط) بيعيد مرة وحدة.
async function olvFetchJson(url: string, init: RequestInit, retries = 0): Promise<{ status: number; out: Record<string, unknown> }> {
  let last = { status: 502, out: { ok: false, error: "موقع المنيو ما رد" } as Record<string, unknown> };
  for (let i = 0; i <= retries; i++) {
    let r: Response;
    try {
      r = await fetch(url, init);
    } catch (e) {
      last = { status: 502, out: { ok: false, error: "تعذّر الاتصال بموقع المنيو: " + (e instanceof Error ? e.message : "fetch failed") } };
      if (i < retries) await new Promise((res) => setTimeout(res, 700));
      continue;
    }
    const text = await r.text();
    try {
      return { status: r.status, out: JSON.parse(text) };
    } catch {
      const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      console.error(`olv-menu non-JSON ${r.status} ${url} cf-ray=${r.headers.get("cf-ray") || "-"} :: ${snippet}`);
      last = { status: 502, out: { ok: false, error: `موقع المنيو رجّع صفحة خطأ بدل البيانات (HTTP ${r.status}): ${snippet || "فاضي"}` } };
      if (i < retries) await new Promise((res) => setTimeout(res, 700));
    }
  }
  return last;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // trim: لو انلزق مع المفتاح مسافة أو سطر جديد أو علامة اتجاه مخفية (من الكيبورد العربي) وقت اللصق بأسرار Supabase، fetch بيرفضه بـ "Invalid header value"
  const adminKey = (Deno.env.get("OLV_ADMIN_KEY") || "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  if (!adminKey) {
    return json({ ok: false, error: "OLV_ADMIN_KEY غير مضبوط بأسرار Supabase (Edge Functions → Secrets)" }, 500);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "إعدادات Supabase ناقصة بالسيرفر" }, 500);
  }
  const authHeader = req.headers.get("authorization") || "";
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: "جلسة غير صالحة" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile } = await admin.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile || profile.is_active === false || !profile.role) {
    return json({ ok: false, error: "غير مصرّح — سجّل دخول بحساب فعّال" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح" }, 400);
  }

  try {
    if (body.action === "list") {
      const { status, out } = await olvFetchJson(OLV_MENU_API, { headers: { "x-olv-admin-key": adminKey } }, 2);
      return json(out, status);
    }

    if (body.action === "update") {
      if (!body.id || !body.status) return json({ ok: false, error: "id و status مطلوبين" }, 400);
      const { status, out } = await olvFetchJson(OLV_MENU_API, {
        method: "PATCH",
        headers: { "x-olv-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify({ id: body.id, status: body.status, ...(typeof body.pickup === "string" ? { pickup: body.pickup } : {}) }),
      });
      if (status < 400 && body.status === "ready" && typeof body.wa_phone === "string") {
        out.whatsapp = await sendWhatsAppReady(admin, String(body.id), body);
      }
      return json(out, status);
    }

    // مزامنة أصناف المخزون (مشروبات وبضاعة جاهزة) مع المنيو العام: كل مادة معلّمة menu_enabled
    // بتظهر بالمنيو، ومتاحة بس لو مخزونها > 0 — لما تخلص بتختفي، ولما ينزل مخزون جديد بترجع.
    // أي حساب فعّال بيقدر يستدعيها (الكاشير مثلًا بعد البيع): ما بتكشف شي ولا بتغيّر غير أصناف المخزون
    if (body.action === "sync_stock") {
      const { data: rows, error } = await admin.from("ingredients")
        .select("menu_item_id, name, menu_name_en, menu_price, menu_cat, current_stock, menu_group, menu_variant")
        .eq("menu_enabled", true);
      if (error) return json({ ok: false, error: error.message }, 500);
      // نكهات المعسل (menu_cat = shisha-flavor) بتروح كخيار نكهة جوا الأرجيلة، والباقي كأصناف بسعر
      const items = (rows || [])
        .filter((r) => r.menu_item_id && r.menu_cat && (r.menu_cat === "shisha-flavor" || Number(r.menu_price) >= 0))
        .map((r) => r.menu_cat === "shisha-flavor"
          ? {
            kind: "shisha_flavor",
            id: r.menu_item_id,
            ar: String(r.name).replace(/^معسل\s*/, ""),
            en: r.menu_name_en || undefined,
            available: Number(r.current_stock) > 0,
          }
          : {
            id: r.menu_item_id,
            ar: r.name,
            en: r.menu_name_en || undefined,
            cat: r.menu_cat,
            price: Number(r.menu_price),
            available: Number(r.current_stock) > 0,
            // بطاقة المادة: الأنواع اللي إلها نفس menu_group بتظهر ببطاقة وحدة، واسم الخيار menu_variant
            group: r.menu_group || undefined,
            variant: r.menu_variant || undefined,
          });
      const r = await fetch(OLV_STOCK_SYNC_API, {
        method: "POST",
        headers: { "x-olv-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const text = await r.text();
      let out: Record<string, unknown>;
      try { out = JSON.parse(text); } catch {
        return json({ ok: false, error: "موقع المنيو ما رد بالشكل المتوقع — تأكد إن تحديث الموقع (stock-sync) منشور" }, 502);
      }
      return json({ ...out, count: items.length, in_stock: items.filter((i) => i.available).length }, r.status);
    }

    // أصناف شاشة البيع (products) من منيو الموقع: الاسم، السعر، التصنيف، الصورة (رابط كامل)، الوصف والترتيب.
    // بتنعمل هون بصلاحية السيرفر حتى تشتغل من أي حساب فعّال (الكاشير كمان)، لأنها بس بتنسخ المنيو العام.
    // صنف انحذف من المنيو بينخفي (is_active=false) بدل ما ينحذف، حتى ما تضيع مبيعاته.
    if (body.action === "sync_products") {
      const r = await fetch(OLV_MENU_JSON, { headers: { "cache-control": "no-cache" } });
      if (!r.ok) return json({ ok: false, error: "تعذّر تحميل منيو الموقع" }, 502);
      // deno-lint-ignore no-explicit-any
      const menu: any = await r.json();
      const catById: Record<string, string> = {};
      // deno-lint-ignore no-explicit-any
      (menu.categories || []).forEach((c: any) => { catById[c.id] = c.ar || c.en || "عام"; });
      // deno-lint-ignore no-explicit-any
      const items = (menu.items || []).filter((it: any) => it.id && it.ar && it.price != null);
      if (!items.length) return json({ ok: false, error: "ما في أصناف بمنيو الموقع" }, 502);
      const abs = (u: string) => /^https?:/i.test(u) ? u : `${OLV_SITE}/${String(u).replace(/^\/+/, "")}`;
      // الحجم الكبير: إضافة «كبير» خاصة بالصنف سعرها = فرق السعر عن الصغير (نفس فكرة وجبة)، فنقطة البيع والسيرفر
      // بيحسبوا الحجم من جدول الإضافات بدون تغيير بدالة record_sale. سعر الصالة بيطلع بنفس الفرق.
      // deno-lint-ignore no-explicit-any
      const sized = items.filter((it: any) => Number(it.large?.price) > Number(it.price));
      const sizeAddonByItem: Record<string, string> = {};
      if (sized.length) {
        // deno-lint-ignore no-explicit-any
        const rows = sized.map((it: any) => ({
          external_id: `size:${it.id}`,
          name: "كبير",
          price: Math.round((Number(it.large.price) - Number(it.price)) * 100) / 100,
          is_active: true,
          is_size: true,
        }));
        const { error: ea } = await admin.from("addons").upsert(rows, { onConflict: "external_id" });
        if (ea) return json({ ok: false, error: ea.message }, 500);
        const { data: got, error: eb } = await admin.from("addons").select("id, external_id").in("external_id", rows.map((r: { external_id: string }) => r.external_id));
        if (eb) return json({ ok: false, error: eb.message }, 500);
        (got || []).forEach((g: { id: string; external_id: string }) => { sizeAddonByItem[g.external_id.slice(5)] = g.id; });
      }
      // deno-lint-ignore no-explicit-any
      const payload = items.map((it: any, i: number) => {
        const row: Record<string, unknown> = {
          external_id: it.id,
          name: it.ar,
          price: Number(it.price),
          category: catById[it.cat] || "عام",
          is_active: it.available !== false,
          sort_order: i,
          // سعر الصالة من المنيو (hallPrice)؛ null يمسحه لو انشال من المنيو
          hall_price: Number(it.hallPrice) > 0 ? Number(it.hallPrice) : null,
        };
        row.large_addon_id = sizeAddonByItem[it.id] ?? null;
        if (it.image) row.image_url = abs(it.image);
        if (it.descAr) row.description = it.descAr;
        return row;
      });
      const { data: before, error: e1 } = await admin.from("products").select("id, external_id, is_active").not("external_id", "is", null);
      if (e1) return json({ ok: false, error: e1.message }, 500);
      const { error: e2 } = await admin.from("products").upsert(payload, { onConflict: "external_id" });
      if (e2) return json({ ok: false, error: e2.message }, 500);
      // deno-lint-ignore no-explicit-any
      const inMenu = new Set(items.map((it: any) => it.id));
      const known = new Set((before || []).map((p) => p.external_id));
      const gone = (before || []).filter((p) => !inMenu.has(p.external_id) && p.is_active).map((p) => p.id);
      if (gone.length) {
        const { error: e3 } = await admin.from("products").update({ is_active: false }).in("id", gone);
        if (e3) return json({ ok: false, error: e3.message }, 500);
      }
      // deno-lint-ignore no-explicit-any
      return json({ ok: true, count: payload.length, added: items.filter((it: any) => !known.has(it.id)).length, hidden: gone.length });
    }

    // رابط دخول لصفحات الإدارة/الموظفين (الموقع العام ما فيه أي رابط إلها). حساب "staff" بياخد رابط الموظفين بس.
    if (body.action === "staff_link") {
      const scope = body.scope === "staff" || profile.role === "staff" ? "staff" : "admin";
      return json({ ok: true, url: await launchLink(adminKey, scope, String(body.to || "")) });
    }

    // التحكم بالطلبات (إيقاف الطلب لكل نوع/قسم بوقت أو يدوياً): بيقرأ ويكتب على /api/controls بموقع المنيو. للمالك والمدير بس
    if (body.action === "get_controls" || body.action === "set_controls") {
      if (!["owner", "manager"].includes(profile.role)) return json({ ok: false, error: "التحكم بالطلبات للمالك والمدير فقط" }, 403);
      const set = body.action === "set_controls";
      const { status, out } = await olvFetchJson(set ? OLV_CONTROLS_API : OLV_CONTROLS_API + "?full=1", {
        method: set ? "POST" : "GET",
        headers: set ? { "x-olv-admin-key": adminKey, "content-type": "application/json" } : { "x-olv-admin-key": adminKey },
        ...(set ? { body: JSON.stringify(body.controls || {}) } : {}),
      }, set ? 0 : 2);
      return json(out, status);
    }

    return json({ ok: false, error: "action غير معروف (list أو update أو sync_stock أو sync_products أو staff_link أو get_controls أو set_controls)" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "خطأ بالسيرفر" }, 500);
  }
});
