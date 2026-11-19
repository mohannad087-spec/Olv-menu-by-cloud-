-- ملف أوراق الموظف (طلب المالك 2026-11-13): هوية، عقد، شهادة صحية... مرفوعة جوّا بطاقة كل موظف.
-- الأوراق شخصية: باكت خاص (ما في رابط عام)، بيشوفها المالك والمدير بس، والحذف للمالك بس.
-- آمن للتشغيل أكتر من مرة.

-- 1) باكت خاص: صور و PDF لحد 8 ميغا
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-docs', 'employee-docs', false, 8388608,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) جدول الأوراق (سطر لكل ورقة)
create table if not exists public.employee_documents (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  doc_type    text not null check (doc_type in ('id','contract','health','clearance','permit','photo','other')),
  title       text check (title is null or char_length(title) <= 120),
  file_path   text not null unique,
  mime_type   text,
  size_bytes  bigint check (size_bytes is null or size_bytes >= 0),
  expires_on  date,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.employee_documents is
  'أوراق الموظفين (هوية، عقد، شهادة صحية...). الملف نفسه بباكت employee-docs الخاص.';

create index if not exists employee_documents_profile_idx on public.employee_documents (profile_id, created_at desc);
create index if not exists employee_documents_uploaded_by_idx on public.employee_documents (uploaded_by);

alter table public.employee_documents enable row level security;
revoke all on public.employee_documents from anon;
grant select, insert, delete on public.employee_documents to authenticated;

-- 3) الصلاحيات: المالك والمدير بيشوفوا وبيرفعوا، والحذف للمالك بس
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_documents' and policyname = 'employee_documents_select') then
    create policy employee_documents_select on public.employee_documents
      for select to authenticated using ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_documents' and policyname = 'employee_documents_insert') then
    create policy employee_documents_insert on public.employee_documents
      for insert to authenticated with check ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_documents' and policyname = 'employee_documents_delete') then
    create policy employee_documents_delete on public.employee_documents
      for delete to authenticated using ((select public.is_owner()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'employee_docs_select') then
    create policy employee_docs_select on storage.objects
      for select to authenticated using (bucket_id = 'employee-docs' and (select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'employee_docs_insert') then
    create policy employee_docs_insert on storage.objects
      for insert to authenticated with check (bucket_id = 'employee-docs' and (select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'employee_docs_delete') then
    create policy employee_docs_delete on storage.objects
      for delete to authenticated using (bucket_id = 'employee-docs' and (select public.is_owner()));
  end if;
end $$;

notify pgrst, 'reload schema';
