-- تعديل فاتورة مشتريات: بخطوة وحدة (بنفس العملية) بتلغي القديمة وبتسجّل الجديدة مكانها.
-- لو أي خطوة فشلت ما بيتغيّر شي (لا مخزون ولا دين مورّد ولا مصروف).
-- لصاحب المطعم فقط، نفس صلاحية الإلغاء. الفاتورة القديمة بتضل بالسجل «ملغاة» ومكتوب عليها إنها انعدّلت.

alter table public.purchase_invoices add column if not exists replaced_by uuid references public.purchase_invoices(id);

create or replace function public.edit_purchase_invoice(
  p_invoice_id uuid,
  p_supplier_id uuid,
  p_invoice_no text,
  p_invoice_date date,
  p_paid numeric,
  p_notes text,
  p_attachment text,
  p_lines jsonb,
  p_discount_amount numeric default 0,
  p_discount_pct numeric default null,
  p_tax_rate numeric default 0,
  p_tax_inclusive boolean default false,
  p_tax_recoverable boolean default true
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_old record;
  v_new uuid;
begin
  if not public.is_owner() then
    raise exception 'تعديل فاتورة مشتريات لصاحب المطعم فقط';
  end if;
  select * into v_old from public.purchase_invoices where id = p_invoice_id for update;
  if v_old.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if v_old.status = 'voided' then raise exception 'هذه الفاتورة ملغاة، ما بينفع تتعدّل'; end if;

  perform public.void_purchase_invoice(p_invoice_id, 'تعديل الفاتورة');

  v_new := public.record_purchase_invoice(
    p_supplier_id, p_invoice_no, p_invoice_date, p_paid, p_notes, p_attachment, p_lines,
    p_discount_amount, p_discount_pct, p_tax_rate, p_tax_inclusive, p_tax_recoverable
  );
  update public.purchase_invoices set replaced_by = v_new where id = p_invoice_id;
  return v_new;
end;
$$;

revoke execute on function public.edit_purchase_invoice(uuid, uuid, text, date, numeric, text, text, jsonb, numeric, numeric, numeric, boolean, boolean) from public, anon;
grant execute on function public.edit_purchase_invoice(uuid, uuid, text, date, numeric, text, text, jsonb, numeric, numeric, numeric, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
