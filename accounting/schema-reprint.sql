-- إعادة طباعة الفاتورة مع سبب إلزامي وسجل ما بيتعدّل
--
-- كل إعادة طباعة:
--   • بتتسجّل بجدول receipt_reprints (مين، ليش، أي رقم إعادة، ومتى)
--   • بتنطبع بتاريخ ووقت الإعادة مع شريط "نسخة مكررة" وسبب الإعادة واسم
--     اللي أعادها، حتى ما تنعطى للزبون نسخة تنقلب لفاتورة أصلية
--   • بتظهر بسجل المبيعات جنب كل فاتورة (كم مرة أُعيدت وأسبابها)
--
-- قيود الكاشير (المدير/المالك بدون قيود، بس بسبب إلزامي):
--   • فواتيره هو بس
--   • خلال staff_reprint_hours ساعة من البيع (افتراضي 24)
--   • بحد أقصى 3 إعادات للفاتورة الواحدة
--   • الفاتورة الملغاة ما بتنطبع
--
-- شغّله بعد schema-cashier-hardening.sql (بيعتمد على دوالها)

alter table public.print_jobs add column if not exists reprint_reason text;
alter table public.print_jobs add column if not exists reprint_no int;
alter table public.print_jobs add column if not exists reprint_by text;

create table if not exists public.receipt_reprints (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales_entries(id) on delete cascade,
  reprint_no int not null,
  reason text not null check (length(trim(reason)) >= 3),
  printed_by uuid references public.profiles(id),
  printed_by_name text,
  created_at timestamptz not null default now(),
  unique (sale_id, reprint_no)
);
create index if not exists receipt_reprints_sale_idx on public.receipt_reprints (sale_id, created_at);

alter table public.receipt_reprints enable row level security;
drop policy if exists receipt_reprints_select on public.receipt_reprints;
create policy receipt_reprints_select on public.receipt_reprints
  for select using (public.auth_role() is not null);
revoke insert, update, delete on public.receipt_reprints from anon, authenticated;

insert into public.app_settings (key, value) values ('staff_reprint_hours', '24')
on conflict (key) do nothing;

-- نفس التوزيع القديم بالضبط (schema-printers-routing.sql) + نسخ بيانات
-- الإعادة لكل مهمة فاتورة موزّعة على طابعات الكاشير
create or replace function public.fan_out_print_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_printer record;
  v_item_ids uuid[];
  v_claimed text[];
begin
  if new.printer_id is not null then return new; end if;
  if not exists (select 1 from public.printers) then return new; end if;

  if new.job_type = 'receipt' then
    insert into public.print_jobs (sale_id, job_type, printer_id, reprint_reason, reprint_no, reprint_by)
    select new.sale_id, 'receipt', p.id, new.reprint_reason, new.reprint_no, new.reprint_by
    from public.printers p where p.enabled and p.kind = 'receipt';
  else
    select coalesce(array_agg(distinct c), '{}') into v_claimed
    from public.printers p, unnest(p.categories) c
    where p.enabled and p.kind = 'station';

    for v_printer in select * from public.printers where enabled and kind = 'station' order by sort_order loop
      select array_agg(si.id) into v_item_ids
      from public.sale_items si
      left join public.products pr on pr.id = si.product_id
      where si.sale_id = new.sale_id and si.status = 'completed'
        and (
          coalesce(pr.category, '') = any(v_printer.categories)
          or (v_printer.catch_unassigned and not (coalesce(pr.category, '') = any(v_claimed)))
        );
      if v_item_ids is not null then
        insert into public.print_jobs (sale_id, job_type, printer_id, item_ids)
        values (new.sale_id, 'kitchen', v_printer.id, v_item_ids);
      end if;
    end loop;
  end if;

  delete from public.print_jobs where id = new.id;
  return new;
end;
$$;

create or replace function public.reprint_receipt(p_sale_id uuid, p_reason text)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_sale record;
  v_reason text := left(trim(coalesce(p_reason, '')), 200);
  v_name text;
  v_no int;
  v_hours numeric;
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if length(v_reason) < 3 then
    raise exception 'سبب إعادة الطباعة مطلوب (3 أحرف على الأقل)';
  end if;

  select * into v_sale from public.sales_entries where id = p_sale_id;
  if v_sale.id is null then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if v_sale.status = 'voided' then
    raise exception 'هذا الطلب ملغى — ما بتنطبع له فاتورة';
  end if;

  if v_role = 'staff' then
    v_hours := public.app_setting_num('staff_reprint_hours', 24);
    if v_sale.created_by is distinct from auth.uid() then
      raise exception 'الكاشير يعيد طباعة فواتيره هو بس — بلّغ المدير';
    end if;
    if now() - v_sale.created_at > v_hours * interval '1 hour' then
      raise exception 'مرّت أكتر من % ساعة على هذه الفاتورة — بلّغ المدير', v_hours;
    end if;
    if (select count(*) from public.receipt_reprints where sale_id = p_sale_id) >= 3 then
      raise exception 'وصلت الحد الأقصى لإعادة طباعة هذه الفاتورة (3 مرات) — بلّغ المدير';
    end if;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  select coalesce(max(reprint_no), 0) + 1 into v_no from public.receipt_reprints where sale_id = p_sale_id;

  insert into public.receipt_reprints (sale_id, reprint_no, reason, printed_by, printed_by_name)
  values (p_sale_id, v_no, v_reason, auth.uid(), v_name);

  insert into public.print_jobs (sale_id, job_type, reprint_reason, reprint_no, reprint_by)
  values (p_sale_id, 'receipt', v_reason, v_no, coalesce(v_name, '—'));

  return v_no;
end;
$$;

revoke execute on function public.reprint_receipt(uuid, text) from public, anon;
grant execute on function public.reprint_receipt(uuid, text) to authenticated;
