-- المصروفات: طريقة الدفع «كاش» أو «ذمة» (لسا ما اندفع).
--   • كاش (الافتراضي): نازل من الدرج بتاريخ المصروف.
--   • ذمة: مسجّل مصروف بس ما نزل من الدرج، وما بينحسب بتقفيل الخزينة لحد ما ينسدّد.
--   • التسديد: payment_type بيصير cash وsettled_at = وقت التسديد، فبينحسب بدرج يوم التسديد.
-- كل التقارير بتضل تحسب المصروف كامل (كاش وذمة) لأنه التزام على المحل.
alter table public.expenses add column if not exists payment_type text not null default 'cash';
alter table public.expenses add column if not exists settled_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_payment_type_chk') then
    alter table public.expenses add constraint expenses_payment_type_chk check (payment_type in ('cash', 'credit'));
  end if;
end $$;
create index if not exists expenses_credit_idx on public.expenses (payment_type) where payment_type = 'credit';
