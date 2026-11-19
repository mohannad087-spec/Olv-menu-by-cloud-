-- نقل حساب طاولة لطاولة ثانية (ولو عليها حساب مفتوح بينضم معه). شغّله بـ SQL Editor، آمن لو انعاد.
create or replace function public.move_table_tab(p_from text, p_to text)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_from text := btrim(coalesce(p_from, ''));
  v_to text := btrim(coalesce(p_to, ''));
  v_n int;
begin
  if public.auth_role() is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if v_from = '' or v_to = '' then
    raise exception 'اختار الطاولة';
  end if;
  if lower(v_from) = lower(v_to) then
    raise exception 'الطاولة هي نفسها';
  end if;
  if not exists (select 1 from public.restaurant_tables where lower(btrim(table_number)) = lower(v_to)) then
    raise exception 'طاولة % مش بقائمة الطاولات', v_to;
  end if;

  perform 1 from public.sales_entries
   where tab_open and status = 'completed' and lower(btrim(table_number)) = lower(v_from)
   order by id for update;

  update public.sales_entries
     set table_number = v_to
   where tab_open and status = 'completed' and lower(btrim(table_number)) = lower(v_from);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'ما في حساب مفتوح على طاولة %، حدّث الصفحة', v_from;
  end if;

  -- الطاولة القديمة بتصير «بدها ترتيب»
  insert into public.table_occupancy (table_number, is_occupied, freed_at)
  values (v_from, false, now())
  on conflict (table_number) do update set is_occupied = false, freed_at = now();

  return v_n;
end;
$$;

revoke execute on function public.move_table_tab(text, text) from public, anon;
grant execute on function public.move_table_tab(text, text) to authenticated;
