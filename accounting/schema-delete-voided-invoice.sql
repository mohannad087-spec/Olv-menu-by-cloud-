-- حذف نهائي لفاتورة مشتريات ملغاة (لصاحب المطعم فقط).
-- الإلغاء أصلًا رجّع المخزون وشال المصروف وقيد المورّد، فهون بنمسح الفاتورة وأسطرها من السجل بس.
-- الفواتير الفعّالة ما بتنحذف أبدًا (لازم تنلغى أول).

create or replace function public.delete_voided_purchase_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_inv record;
begin
  if not public.is_owner() then
    raise exception 'حذف فاتورة مشتريات لصاحب المطعم فقط';
  end if;
  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if v_inv.status <> 'voided' then raise exception 'بتنحذف الفواتير الملغاة بس، الغي الفاتورة أول'; end if;

  -- فاتورة ملغاة قديمة ممكن تكون مشيرة لهاي كـ«بديل» بعد التعديل
  update public.purchase_invoices set replaced_by = null where replaced_by = p_invoice_id;
  -- أسطرها لازم تنمسح معها (لو بقيت بلا فاتورة كانت رح تنحسب كشراء فعّال بحساب آخر سعر)
  delete from public.purchases where invoice_id = p_invoice_id;
  delete from public.supplier_transactions where invoice_id = p_invoice_id;
  delete from public.purchase_invoices where id = p_invoice_id;
end;
$$;

revoke execute on function public.delete_voided_purchase_invoice(uuid) from public, anon;
grant execute on function public.delete_voided_purchase_invoice(uuid) to authenticated;

notify pgrst, 'reload schema';
