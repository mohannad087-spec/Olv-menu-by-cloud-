-- تقوية نظام الرواتب (2026-11-07). آمن للتشغيل أكتر من مرة.
-- 1) دالة record_payroll_payment: تسجيل الدفعة + تسكير الإضافات والسلف بعملية وحدة (إما كلها أو ولا شي)
--    مع قفل على الموظف وفحص إنه ما انسجلت دفعة جديدة من جهاز ثاني.
-- 2) قيود على جدول الدفعات (ما بيقبل مبلغ سالب أو فترة مقلوبة).
-- 3) تسجيل أي تعديل/حذف على الإضافات والخصومات بسجل التدقيق.
-- 4) حماية السجل: حذف الموظف ما بيمسح دفعاته وسلفه وإضافاته وبصماته (RESTRICT بدل CASCADE).

create or replace function public.record_payroll_payment(
  p_id uuid,
  p_profile uuid,
  p_start date,
  p_end date,
  p_hours numeric,
  p_wage numeric,
  p_gross numeric,
  p_advances numeric,
  p_net numeric,
  p_note text,
  p_adj_ids uuid[],
  p_advance_ids uuid[],
  p_expected_last_end date
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_last date;
  v_n int;
  v_sum numeric;
begin
  -- نفس الدفعة انبعتت مرتين (إعادة محاولة): ما بنكررها
  if exists (select 1 from payroll_payments where id = p_id) then
    return p_id;
  end if;

  -- قفل على الموظف: دفعتين بنفس اللحظة بيمشوا وحدة ورا التانية
  perform pg_advisory_xact_lock(hashtext('payroll:' || p_profile::text));

  select max(period_end) into v_last from payroll_payments where profile_id = p_profile;
  if v_last is distinct from p_expected_last_end then
    raise exception 'stale_ledger: انسجلت دفعة جديدة لهالموظف (آخر فترة %). حدّث الصفحة وارجع جرّب.', v_last
      using errcode = 'P0001';
  end if;

  if p_net < 0 or p_hours < 0 or coalesce(p_advances, 0) < 0 or p_start > p_end then
    raise exception 'بيانات الدفعة غير صحيحة' using errcode = '22023';
  end if;

  -- السلف المخصومة لازم تساوي مجموع السلف المختارة فعلاً
  select count(*), coalesce(sum(amount), 0) into v_n, v_sum
    from salary_advances
   where id = any(coalesce(p_advance_ids, '{}')) and profile_id = p_profile and settled_payroll_id is null;
  if v_n <> coalesce(array_length(p_advance_ids, 1), 0) then
    raise exception 'سلفة انسددت أو انحذفت من جهاز ثاني. حدّث الصفحة.' using errcode = 'P0001';
  end if;
  if abs(v_sum - coalesce(p_advances, 0)) > 0.005 then
    raise exception 'مجموع السلف (%) غير المسجّل (%)', v_sum, p_advances using errcode = '22023';
  end if;

  select count(*) into v_n
    from payroll_adjustments
   where id = any(coalesce(p_adj_ids, '{}')) and profile_id = p_profile and settled_payroll_id is null;
  if v_n <> coalesce(array_length(p_adj_ids, 1), 0) then
    raise exception 'إضافة أو خصم انحذف أو انسوّى من جهاز ثاني. حدّث الصفحة.' using errcode = 'P0001';
  end if;

  insert into payroll_payments (id, profile_id, period_start, period_end, hours_worked, hourly_wage,
                                gross_amount, advances_deducted, net_amount, note, paid_by)
  values (p_id, p_profile, p_start, p_end, p_hours, p_wage, p_gross, coalesce(p_advances, 0), p_net, p_note, auth.uid());

  update payroll_adjustments set settled_payroll_id = p_id
   where id = any(coalesce(p_adj_ids, '{}')) and settled_payroll_id is null;
  update salary_advances set settled_payroll_id = p_id
   where id = any(coalesce(p_advance_ids, '{}')) and settled_payroll_id is null;

  return p_id;
end;
$$;

revoke all on function public.record_payroll_payment(uuid, uuid, date, date, numeric, numeric, numeric, numeric, numeric, text, uuid[], uuid[], date) from public, anon;
grant execute on function public.record_payroll_payment(uuid, uuid, date, date, numeric, numeric, numeric, numeric, numeric, text, uuid[], uuid[], date) to authenticated;

-- قيود الدفعات
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payroll_payments_net_nonneg') then
    alter table payroll_payments add constraint payroll_payments_net_nonneg check (net_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_payments_period_ok') then
    alter table payroll_payments add constraint payroll_payments_period_ok check (period_start <= period_end);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_payments_hours_nonneg') then
    alter table payroll_payments add constraint payroll_payments_hours_nonneg check (hours_worked >= 0 and advances_deducted >= 0);
  end if;
end $$;

-- سجل تدقيق للإضافات والخصومات (كانت الوحيدة بدون سجل)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'payroll_adjustments_audit' and not tgisinternal) then
    create trigger payroll_adjustments_audit after insert or update or delete on payroll_adjustments
      for each row execute function log_audit('');
  end if;
end $$;

-- حذف موظف ما بيمسح تاريخه المالي
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text tbl, c.conname
      from pg_constraint c
     where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype = 'c'
       and c.conrelid::regclass::text in ('payroll_payments', 'payroll_adjustments', 'salary_advances', 'employee_punches')
       and c.conkey = (select array_agg(attnum) from pg_attribute where attrelid = c.conrelid and attname = 'profile_id')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (profile_id) references profiles(id) on delete restrict', r.tbl, r.conname);
  end loop;
end $$;
