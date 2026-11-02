-- طريقة سداد دفعات الموردين: كاش أو بنك أو كليك.
-- الدفعات القديمة بتنحسب كاش. التقارير والدرج ما بتتأثر (دفعات الموردين ما بتنزل من الدرج).
-- آمن للتشغيل أكثر من مرة.
alter table public.supplier_transactions
  add column if not exists payment_method text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_transactions_payment_method_chk') then
    alter table public.supplier_transactions
      add constraint supplier_transactions_payment_method_chk
      check (payment_method is null or payment_method in ('cash', 'bank', 'click'));
  end if;
end $$;
