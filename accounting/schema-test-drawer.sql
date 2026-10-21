-- فحص درج الكاش: مهمة تجريبية بدون ورقة، بس بتخلّي برنامج الطباعة يبعت أمر فتح الدرج
-- لطابعة الكاشير (test_layout = {"drawer_only": true}). لأي موظف مسجّل، وبحد تذكرة كل ١٠ ثواني للطابعة.
create or replace function public.test_drawer(p_printer_id uuid)
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
  if not exists (select 1 from public.printers where id = p_printer_id and kind = 'receipt') then
    raise exception 'فحص الدرج لطابعة الكاشير فقط';
  end if;
  if exists (
    select 1 from public.print_jobs
    where printer_id = p_printer_id and job_type = 'test'
      and created_at > now() - interval '10 seconds'
  ) then
    raise exception 'استنى ١٠ ثواني بين كل فحص والتاني';
  end if;
  insert into public.print_jobs (job_type, printer_id, test_layout)
    values ('test', p_printer_id, '{"drawer_only": true}'::jsonb)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.test_drawer(uuid) from public, anon;
grant execute on function public.test_drawer(uuid) to authenticated;
