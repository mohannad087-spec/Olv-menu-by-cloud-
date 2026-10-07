-- شاشة المطبخ: وقت الجاهزية + منع تجهيز طلب ملغى.
-- يُطبّق مرة وحدة بـ SQL Editor (آمن للتكرار).

-- وقت ما الطلب صار «جاهز» (بيرجع null لما ينرجع لقيد التحضير) — لحساب مدة التحضير
alter table public.sales_entries add column if not exists kitchen_ready_at timestamptz;

create or replace function public.set_kitchen_status(p_sale_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
begin
  if public.auth_role() is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if p_status not in ('قيد التحضير', 'جاهز') then
    raise exception 'حالة غير صالحة';
  end if;
  select status into v_status from public.sales_entries where id = p_sale_id for update;
  if v_status is null then
    raise exception 'الطلب غير موجود';
  end if;
  if v_status = 'voided' then
    raise exception 'هذا الطلب ملغى';
  end if;
  update public.sales_entries
     set kitchen_status = p_status,
         kitchen_ready_at = case when p_status = 'جاهز' then coalesce(kitchen_ready_at, now()) else null end
   where id = p_sale_id;
end;
$$;

revoke execute on function public.set_kitchen_status(uuid, text) from public, anon;
grant execute on function public.set_kitchen_status(uuid, text) to authenticated;

-- سجل التعديلات: حالة المطبخ ووقت الجاهزية ضجيج، ما بينسجّلوا
drop trigger if exists sales_entries_audit on public.sales_entries;
create trigger sales_entries_audit after update or delete on public.sales_entries
  for each row execute function public.log_audit('kitchen_status,kitchen_ready_at');
