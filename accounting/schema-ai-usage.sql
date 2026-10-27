-- عدّاد استهلاك الذكاء الاصطناعي (Gemini): كل طلب من دوال السيرفر (_shared/gemini.ts) بينسجّل هون.
-- «المساعد الذكي» بيقرأه عن طريق الدالة item-cards-ai (action: usage)، فما في سياسات للمتصفح (RLS بدون سياسات = السيرفر بس).
-- الحد اليومي التقديري بـ app_settings.ai_daily_limit (الافتراضي 250 طلب، حسب حد جوجل المجاني للموديل).
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  fn text not null,
  model text not null,
  status int not null,
  ms int,
  prompt_tokens int not null default 0,
  output_tokens int not null default 0,
  thought_tokens int not null default 0,
  total_tokens int not null default 0
);
create index if not exists ai_usage_created_at_idx on public.ai_usage (created_at);
alter table public.ai_usage enable row level security;
