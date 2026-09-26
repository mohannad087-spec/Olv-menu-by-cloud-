// وسيط آمن لإدارة حسابات الموظفين (إنشاء حساب جديد، إيقاف/تفعيل، إعادة
// تعيين كلمة سر) — العمليات هذه تحتاج مفتاح service_role (صلاحية إدارية
// كاملة على مشروع Supabase)، وهذا المفتاح ما بينكشف أبدًا لكود المتصفح؛
// هذا سبب وجود الوسيط بدل ما تتعامل صفحة employees.html مباشرة مع
// Supabase Admin API.
//
// Supabase بتتحقق من تسجيل دخول المستخدم (Bearer token) تلقائيًا قبل ما
// توصّل الطلب لهون (verify_jwt الافتراضي)، بس هيك بس بيثبت إنه "مسجّل
// دخول"، مو إنه "مدير" — فالتحقق من الدور (owner/manager) صايرة يدويًا
// هون بعد قراءة هويته الحقيقية من توكنه.
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

// كلمة سر مؤقتة قوية بما فيه الكفاية — يشاركها المدير مع الموظف الجديد
// مباشرة (بما إن الفريق صغير ومحلي)، وينصح الموظف يغيّرها أول ما يدخل
function randomTempPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 14) + "!1";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط بأسرار Edge Functions" }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  // عميل بجلسة المستدعي نفسه — يُستخدم فقط للتأكد من هويته، وما إله أي
  // صلاحية إدارية أكتر من صلاحية المستخدم صاحب الجلسة
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: "جلسة غير صالحة" }, 401);

  // عميل إداري كامل (service_role) — يُستخدم فقط بعد التأكد من دور المستدعي
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!callerProfile || !["owner", "manager"].includes(callerProfile.role)) {
    return json({ ok: false, error: "هذه العملية تحتاج صلاحية مدير أو مالك" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح" }, 400);
  }

  try {
    if (body.action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const fullName = String(body.full_name || "").trim();
      const role = String(body.role || "staff");
      if (!email || !fullName) return json({ ok: false, error: "البريد والاسم مطلوبين" }, 400);
      if (!["owner", "manager", "staff"].includes(role)) return json({ ok: false, error: "دور غير صالح" }, 400);
      // المدير يقدر يضيف كاشير بس — إضافة مدير أو مالك جديد تحتاج صاحب
      // المطعم نفسه، حتى مدير ما يقدر يصنع مدراء/مالكين آخرين
      if (callerProfile.role === "manager" && role !== "staff") {
        return json({ ok: false, error: "المدير يقدر يضيف كاشير بس — إضافة مدير أو مالك تحتاج صاحب المطعم" }, 403);
      }
      const tempPassword = randomTempPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password: tempPassword, email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr) return json({ ok: false, error: createErr.message }, 400);
      // trigger handle_new_user() (schema.sql) بينشئ صف profiles تلقائيًا
      // بدور staff افتراضي فقط — نحدّثه هون بالبيانات الحقيقية
      const { error: updateErr } = await admin.from("profiles").update({
        full_name: fullName,
        role,
        phone: body.phone ? String(body.phone) : null,
        hourly_wage: body.hourly_wage != null && body.hourly_wage !== "" ? Number(body.hourly_wage) : null,
      }).eq("id", created.user.id);
      if (updateErr) return json({ ok: false, error: updateErr.message }, 400);
      return json({ ok: true, userId: created.user.id, tempPassword }, 201);
    }

    if (body.action === "set_active") {
      const targetId = String(body.userId || "");
      const active = Boolean(body.active);
      if (!targetId) return json({ ok: false, error: "userId مطلوب" }, 400);
      if (targetId === user.id) return json({ ok: false, error: "ما تقدر توقف حسابك أنت" }, 400);
      // إيقاف/رفع حظر تسجيل الدخول فعليًا (مو بس علامة شكلية) — "none"
      // هي القيمة الموثّقة برمجيًا لرفع الحظر بـSupabase، وليست "0s" (لا
      // تعتبر إلغاء حظر). ملاحظة مهمة: الحظر ما بيلغي جلسة مفتوحة أصلًا
      // فورًا (بيمنع بس تسجيل دخول/تجديد جلسة جديد) — لهذا olvRequireAuth
      // بيتحقق من profiles.is_active كمان على كل صفحة، حتى الموظف يطلع
      // فورًا لو كانت جلسته مفتوحة وقت إيقافه
      const { error: banErr } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: active ? "none" : "876000h",
      });
      if (banErr) return json({ ok: false, error: banErr.message }, 400);
      const { error: profErr } = await admin.from("profiles").update({ is_active: active }).eq("id", targetId);
      if (profErr) return json({ ok: false, error: profErr.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "reset_password") {
      const targetId = String(body.userId || "");
      if (!targetId) return json({ ok: false, error: "userId مطلوب" }, 400);
      const tempPassword = randomTempPassword();
      const { error } = await admin.auth.admin.updateUserById(targetId, { password: tempPassword });
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true, tempPassword });
    }

    return json({ ok: false, error: "action غير معروف (create، set_active، أو reset_password)" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "خطأ بالسيرفر" }, 500);
  }
});
