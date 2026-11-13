-- فصل المكافأة عن الساعات (طلب المالك 2026-11-13): مكافأة كل دفعة بتتخزن بخانة لحالها
-- بدل ما تكون مكتوبة ضمن نص الملاحظة. آمن للتشغيل أكتر من مرة.

-- 1) الخانة الجديدة. القيمة بتيجي من إعداد مؤقت بتحطه الدالة تحت (حتى ما نغيّر دالة التسجيل الأساسية)
alter table public.payroll_payments
  add column if not exists bonus_amount numeric
  default nullif(current_setting('olv.payroll_bonus', true), '')::numeric;

comment on column public.payroll_payments.bonus_amount is
  'المكافأة الأسبوعية المحسوبة ضمن هالدفعة (10 عن كل جمعة). بند لحاله، مش ساعات.';

-- 2) تعبئة الدفعات القديمة من نص الملاحظة («مكافأة 10.00»)
update public.payroll_payments
   set bonus_amount = coalesce((regexp_match(note, 'مكافأة\s*([\d.]+)'))[1]::numeric, 0)
 where bonus_amount is null;

-- 3) دالة تسجيل الدفعة مع المكافأة كبند مستقل: بتحط المكافأة وبتنادي الدالة الموجودة (كل شي بعملية وحدة)
create or replace function public.record_payroll_payment(
  p_id uuid, p_profile uuid, p_start date, p_end date, p_hours numeric, p_wage numeric, p_gross numeric,
  p_advances numeric, p_net numeric, p_note text, p_adj_ids uuid[], p_advance_ids uuid[],
  p_expected_last_end date, p_pay_source text, p_bonus numeric)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if p_bonus is null or p_bonus < 0 then
    raise exception 'قيمة المكافأة غير صحيحة' using errcode = '22023';
  end if;
  perform set_config('olv.payroll_bonus', p_bonus::text, true);
  if p_pay_source is null then
    v_id := public.record_payroll_payment(p_id, p_profile, p_start, p_end, p_hours, p_wage, p_gross,
                                          p_advances, p_net, p_note, p_adj_ids, p_advance_ids, p_expected_last_end);
  else
    v_id := public.record_payroll_payment(p_id, p_profile, p_start, p_end, p_hours, p_wage, p_gross,
                                          p_advances, p_net, p_note, p_adj_ids, p_advance_ids, p_expected_last_end, p_pay_source);
  end if;
  perform set_config('olv.payroll_bonus', '', true);
  return v_id;
end;
$function$;

revoke all on function public.record_payroll_payment(uuid, uuid, date, date, numeric, numeric, numeric, numeric, numeric, text, uuid[], uuid[], date, text, numeric) from public, anon;
grant execute on function public.record_payroll_payment(uuid, uuid, date, date, numeric, numeric, numeric, numeric, numeric, text, uuid[], uuid[], date, text, numeric) to authenticated;

notify pgrst, 'reload schema';
