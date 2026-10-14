-- رمز جسر البصمة: بدل ما نحط مفتاح service_role على كمبيوتر المحل، الجسر
-- بيرسل البصمات لدالة attendance-ingest برمز خاص. الجدول بيخزّن بصمة
-- (SHA-256) الرمز بس، مو الرمز نفسه. RLS مفعّل بدون أي policy يعني ما
-- في وصول من المتصفح، والدالة بتقرأه عبر service_role.
create table if not exists public.attendance_bridge_tokens (
  id uuid primary key default gen_random_uuid(),
  token_sha256 text not null unique,
  label text,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.attendance_bridge_tokens enable row level security;
revoke all on public.attendance_bridge_tokens from anon, authenticated;
