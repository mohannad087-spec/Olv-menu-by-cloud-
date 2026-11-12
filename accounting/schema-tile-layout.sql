-- ترتيب وأحجام تايلات الصفحة الرئيسية، لكل مستخدم (بيلحقه على أي جهاز)
create table if not exists public.user_tile_layout (
  user_id uuid primary key references auth.users(id) on delete cascade,
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_tile_layout enable row level security;

drop policy if exists user_tile_layout_own on public.user_tile_layout;
create policy user_tile_layout_own on public.user_tile_layout
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
