-- فحص الطباعة للكاشير: أي موظف مسجّل (فعّال) بيقدر يطلب تذكرة تجريبية على طابعة
-- موجودة، بدون ما يقدر يعدّل الـIP أو الطابعات. test_print الأصلية بتضل للمالك
-- (لأنها بتقبل تصميم مخصّص). هاي بدون تصميم، وبحد أقصى تذكرة كل ١٠ ثواني للطابعة.
create or replace function public.staff_test_print(p_printer_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if public.auth_role() is null then
    raise exception 'لازم تسجّل دخول';
  end if;
  if not exists (select 1 from public.printers where id = p_printer_id) then
    raise exception 'الطابعة غير موجودة';
  end if;
  if exists (
    select 1 from public.print_jobs
    where printer_id = p_printer_id and job_type = 'test'
      and created_at > now() - interval '10 seconds'
  ) then
    raise exception 'استنى ١٠ ثواني بين كل فحص والتاني';
  end if;
  insert into public.print_jobs (job_type, printer_id)
    values ('test', p_printer_id)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.staff_test_print(uuid) from public, anon;
grant execute on function public.staff_test_print(uuid) to authenticated;
