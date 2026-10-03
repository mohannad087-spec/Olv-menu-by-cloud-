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
const OLV_STOCK_SYNC_API = "https://olv-menu.pages.dev/api/stock-sync";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const adminKey = Deno.env.get("OLV_ADMIN_KEY");
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
      const r = await fetch(OLV_MENU_API, { headers: { "x-olv-admin-key": adminKey } });
      const out = await r.json();
      return json(out, r.status);
    }

    if (body.action === "update") {
      if (!body.id || !body.status) return json({ ok: false, error: "id و status مطلوبين" }, 400);
      const r = await fetch(OLV_MENU_API, {
        method: "PATCH",
        headers: { "x-olv-admin-key": adminKey, "content-type": "application/json" },
        body: JSON.stringify({ id: body.id, status: body.status }),
      });
      const out = await r.json();
      return json(out, r.status);
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

    return json({ ok: false, error: "action غير معروف (list أو update أو sync_stock)" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "خطأ بالسيرفر" }, 500);
  }
});
