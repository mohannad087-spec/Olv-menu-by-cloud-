-- حماية ديون الموردين: قبل كان حذف المورّد بيمسح معه كل فواتيره ودفعاته (حتى القيود الجاية
-- من فواتير المشتريات)، فالدين بيختفي والفاتورة بتضل بلا مورّد.
-- هلأ السيرفر بيرفض حذف أي مورّد إله سجل حساب أو فواتير مشتريات فعّالة (الملغاة ما بتمنع). المورّد الفاضي بينحذف عادي.
-- آمن للتكرار.

create or replace function public.guard_supplier_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.supplier_transactions where supplier_id = old.id)
     or exists (select 1 from public.purchase_invoices where supplier_id = old.id and status = 'active') then
    raise exception 'ما بينحذف «%» لأنه إله سجل فواتير أو دفعات — الحذف بيضيّع الدين', old.name
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create or replace trigger suppliers_guard_delete before delete on public.suppliers
  for each row execute function public.guard_supplier_delete();
