require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("خطأ: تأكد من ضبط SUPABASE_URL و SUPABASE_SERVICE_KEY (كـ Secrets أو بملف .env محليًا)");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

module.exports = { supabase };
