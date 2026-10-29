-- إعادة طباعة الفاتورة على طابعة يختارها الكاشير.
-- reprint_receipt_to = نفس قيود reprint_receipt (سبب إلزامي، فواتير الكاشير هو، 24 ساعة، 3 مرات)
-- بس الفاتورة بتنبعت لطابعة وحدة محددة بدل كل طابعات الفاتورة، واسم الطابعة بينحفظ بسجل الإعادة.
-- لو p_printer_id فاضي بتنطبع على طابعات الفاتورة مثل قبل. آمن لإعادة التشغيل. شغّله بعد schema-reprint.sql.

alter table public.receipt_reprints add column if not exists printer_name text;

create or replace function public.reprint_receipt_to(p_sale_id uuid, p_reason text, p_printer_id uuid default null)
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
  v_printer record;
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

  if p_printer_id is not null then
    select * into v_printer from public.printers where id = p_printer_id;
    if v_printer.id is null or not v_printer.enabled then
      raise exception 'الطابعة غير موجودة أو متوقفة';
    end if;
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

  insert into public.receipt_reprints (sale_id, reprint_no, reason, printed_by, printed_by_name, printer_name)
  values (p_sale_id, v_no, v_reason, auth.uid(), v_name, v_printer.name);

  insert into public.print_jobs (sale_id, job_type, printer_id, reprint_reason, reprint_no, reprint_by)
  values (p_sale_id, 'receipt', p_printer_id, v_reason, v_no, coalesce(v_name, '—'));

  return v_no;
end;
$$;

revoke execute on function public.reprint_receipt_to(uuid, text, uuid) from public, anon;
grant execute on function public.reprint_receipt_to(uuid, text, uuid) to authenticated;
