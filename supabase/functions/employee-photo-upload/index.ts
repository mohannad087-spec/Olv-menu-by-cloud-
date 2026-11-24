// رفع صورة الموظف من جهاز البصمة لبطاقته بالبرنامج. بيشتغل من كمبيوتر المحل
// برمز الجسر (x-bridge-token) نفس attendance-ingest، لهيك verify_jwt مطفي.
// الصورة بتنحفظ ببكت خاص employee-photos باسم <profile_id>.jpg.
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BYTES = 1024 * 1024;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "إعدادات الدالة ناقصة" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const token = req.headers.get("x-bridge-token") || "";
  if (token.length < 20) return json({ ok: false, error: "رمز غير صالح" }, 401);
  const { data: tok } = await admin
    .from("attendance_bridge_tokens").select("id, revoked").eq("token_sha256", await sha256(token)).maybeSingle();
  if (!tok || tok.revoked) return json({ ok: false, error: "رمز غير صالح" }, 401);

  const no = String(req.headers.get("x-employee-no") || "").trim();
  if (!/^\d{1,10}$/.test(no)) return json({ ok: false, error: "رقم موظف غير صالح" }, 400);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return json({ ok: false, error: "حجم الصورة غير مقبول" }, 400);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ ok: false, error: "الملف مش صورة JPEG" }, 400);

  const { data: prof, error: pErr } = await admin.from("profiles").select("id").eq("device_user_id", no).maybeSingle();
  if (pErr) return json({ ok: false, error: pErr.message }, 500);
  if (!prof) return json({ ok: false, error: "ما في موظف مربوط بهالرقم" }, 404);

  const path = `${prof.id}.jpg`;
  const { error: upErr } = await admin.storage.from("employee-photos").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (upErr) return json({ ok: false, error: upErr.message }, 500);
  const { error: setErr } = await admin.from("profiles").update({ photo_path: path }).eq("id", prof.id);
  if (setErr) return json({ ok: false, error: setErr.message }, 500);
  return json({ ok: true, employeeNo: no, bytes: bytes.length });
});
