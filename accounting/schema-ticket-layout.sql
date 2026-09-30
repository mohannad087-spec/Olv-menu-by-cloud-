-- تخصيص شكل الفاتورة/التذكرة لكل طابعة (كاشير + كل محطة تحضير)
--
-- كل طابعة صار إلها تصميم خاص (عمود ticket_layout): أي عنصر بالفاتورة ممكن
-- تظهره أو تخفيه أو تغيّر حجمه أو نصه، وبتشوف معاينة حية قبل الحفظ من
-- الإعدادات ← الطباعة ← زر "تخصيص". التصميم الفاضي (null) = الشكل الأصلي.
--
-- الطباعة التجريبية (اتصال أو بتصميم كامل) لصاحب المطعم فقط، والسيرفر بيفرض
-- هالشي: المدير يقدر يخصّص التصميم بس ما يقدر يطلب طباعة تجريبية.
--
-- شغّله بعد schema-cashier-hardening.sql (بيعتمد على دوالها)

alter table public.printers add column if not exists ticket_layout jsonb;
alter table public.printers drop constraint if exists printers_ticket_layout_size;
alter table public.printers
  add constraint printers_ticket_layout_size
  check (ticket_layout is null or pg_column_size(ticket_layout) < 16000);

alter table public.print_jobs add column if not exists test_layout jsonb;

-- مهام الطباعة: المدير/المالك يكتبوا، لكن مهام التجريب (job_type = test) للمالك بس
drop policy if exists print_jobs_admin_write on public.print_jobs;
drop policy if exists print_jobs_admin_insert on public.print_jobs;
drop policy if exists print_jobs_admin_update on public.print_jobs;
drop policy if exists print_jobs_admin_delete on public.print_jobs;
create policy print_jobs_admin_insert on public.print_jobs
  for insert with check (public.is_admin() and (job_type <> 'test' or public.is_owner()));
create policy print_jobs_admin_update on public.print_jobs
  for update using (public.is_admin())
  with check (public.is_admin() and (job_type <> 'test' or public.is_owner()));
create policy print_jobs_admin_delete on public.print_jobs
  for delete using (public.is_admin());

-- طباعة تجريبية: p_layout = null → اختبار اتصال بسيط، غير هيك → عيّنة كاملة
-- بالتصميم المعطى (بدون ما تحفظه)
create or replace function public.test_print(p_printer_id uuid, p_layout jsonb default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'الطباعة التجريبية لصاحب المطعم فقط';
  end if;
  if not exists (select 1 from public.printers where id = p_printer_id) then
    raise exception 'الطابعة غير موجودة';
  end if;
  if p_layout is not null and pg_column_size(p_layout) >= 16000 then
    raise exception 'التصميم كبير زيادة';
  end if;
  insert into public.print_jobs (job_type, printer_id, test_layout)
  values ('test', p_printer_id, p_layout)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.test_print(uuid, jsonb) from public, anon;
grant execute on function public.test_print(uuid, jsonb) to authenticated;

-- كل تعديل/حذف على الطابعات (بما فيه التصميم) يظهر بسجل التدقيق
drop trigger if exists printers_audit on public.printers;
create trigger printers_audit
  after insert or update or delete on public.printers
  for each row execute function public.log_audit('');
