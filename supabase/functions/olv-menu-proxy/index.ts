// وسيط آمن بين نظام المحاسبة وموقع المنيو الحقيقي (olv-menu.pages.dev، منشور على Cloudflare Pages).
//
// Supabase تتحقق من تسجيل دخول المستخدم (Bearer token) تلقائيًا قبل ما
// توصّل الطلب لهون — طالما الدالة منشورة بإعداداتها الافتراضية (بدون
// تعطيل verify_jwt). المفتاح الإداري لموقع المنيو (OLV_ADMIN_KEY) محفوظ
// كسر بجانب السيرفر فقط عبر Deno.env، وما بينكشف أبدًا لكود المتصفح —
// هذا هو سبب وجود هذا الوسيط بدل ما تتواصل صفحة المحاسبة مباشرة مع موقع
// المنيو (يلي كمان ما فيه إعدادات CORS تسمح بذلك أصلًا).

const OLV_MENU_API = "https://olv-menu.pages.dev/api/orders";

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

    return json({ ok: false, error: "action غير معروف (list أو update)" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "خطأ بالسيرفر" }, 500);
  }
});
