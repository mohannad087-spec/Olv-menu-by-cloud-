-- الويتر بيطلب طباعة حساب طاولة مفتوح (2026-10-30): مسودة أو نسخة زبون، وبيختار الطابعة (كاش، بار...).
-- الدفع والفاتورة النهائية عند الكاشير. بيعتمد على schema-waiter-role.sql، ولازم يتحدّث print-bridge (update.bat).
-- ما بيفتح الدرج وما بيتسجّل كبيع: بس ورقة حساب. آمن لإعادة التشغيل.

alter table public.print_jobs add column if not exists bill_kind text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'print_jobs_bill_kind_check' and conrelid = 'public.print_jobs'::regclass) then
    alter table public.print_jobs add constraint print_jobs_bill_kind_check check (bill_kind is null or bill_kind in ('draft', 'customer'));
  end if;
end $$;

create or replace function public.waiter_printers()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind) order by (p.kind = 'receipt') desc, p.sort_order, p.created_at)
    from public.printers p where p.enabled), '[]'::jsonb);
end;
$$;

create or replace function public.waiter_print_bill(p_sale_id uuid, p_kind text, p_printer_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  if p_kind not in ('draft', 'customer') then raise exception 'نوع الطباعة غير صالح'; end if;
  if not exists (select 1 from public.sales_entries where id = p_sale_id and tab_open and status = 'completed') then
    raise exception 'الحساب انسدّد أو انلغى، حدّث الصفحة';
  end if;
  if not exists (select 1 from public.printers where id = p_printer_id and enabled) then
    raise exception 'الطابعة غير موجودة أو متوقفة';
  end if;
  if exists (select 1 from public.print_jobs where sale_id = p_sale_id and bill_kind is not null and created_at > now() - interval '20 seconds') then
    raise exception 'انطلبت طباعة قبل ثواني، استنى شوي';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.print_jobs (sale_id, job_type, printer_id, bill_kind, reprint_by)
  values (p_sale_id, 'receipt', p_printer_id, p_kind, coalesce(v_name, '—'));
end;
$$;

revoke execute on function public.waiter_printers() from public, anon;
revoke execute on function public.waiter_print_bill(uuid, text, uuid) from public, anon;
grant execute on function public.waiter_printers() to authenticated;
grant execute on function public.waiter_print_bill(uuid, text, uuid) to authenticated;
