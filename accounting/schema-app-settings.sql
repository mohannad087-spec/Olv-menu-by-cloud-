create table if not exists public.app_settings (
  key text primary key,
  value text
);

insert into public.app_settings (key, value)
values ('reset_pin', '1234')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists app_settings_rw on public.app_settings;
create policy app_settings_rw on public.app_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
