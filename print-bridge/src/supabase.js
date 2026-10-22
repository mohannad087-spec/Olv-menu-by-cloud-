require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("خطأ: تأكد من ضبط SUPABASE_URL و SUPABASE_SERVICE_KEY في ملف .env");
  process.exit(1);
}

// مهلة 10 ثواني لكل طلب: لو النت مقطوع أو معلّق، الدورة ما بتعلق وطباعة الطلبات المحلية بتضل شغّالة
const fetchWithTimeout = (input, init = {}) =>
  fetch(input, init.signal ? init : { ...init, signal: AbortSignal.timeout(10000) });

const supabase = createClient(url, key, {
  auth: { persistSession: false },
  global: { fetch: fetchWithTimeout },
});

module.exports = { supabase };
