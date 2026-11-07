-- دفع الراتب بينزل مصروف تلقائياً (تصنيف «رواتب وأجور») ويحدد من وين طلع: الدرج، نقد خارجي، أو بنك/كليك.
-- آمن للتشغيل أكتر من مرة. بتشتغل مع schema-payroll-hardening.sql (لازم يكون منطبق قبل).

alter table public.expenses add column if not exists payroll_payment_id uuid references public.payroll_payments(id) on delete restrict;
create unique index if not exists expenses_payroll_payment_uidx on public.expenses (payroll_payment_id) where payroll_payment_id is not null;

create or replace function public.record_payroll_payment(
  p_id uuid, p_profile uuid, p_start date, p_end date, p_hours numeric, p_wage numeric, p_gross numeric,
  p_advances numeric, p_net numeric, p_note text, p_adj_ids uuid[], p_advance_ids uuid[], p_expected_last_end date,
  p_pay_source text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_cat uuid;
  v_src text;
begin
  if p_pay_source is null or p_pay_source not in ('drawer', 'cash', 'bank') then
    raise exception 'اختار من وين الدفع (الدرج، نقد خارجي، بنك/كليك)' using errcode = '22023';
  end if;
  v_id := public.record_payroll_payment(p_id, p_profile, p_start, p_end, p_hours, p_wage, p_gross,
                                        p_advances, p_net, p_note, p_adj_ids, p_advance_ids, p_expected_last_end);
  if p_net > 0 then
    select full_name into v_name from profiles where id = p_profile;
    select id into v_cat from expense_categories where name = 'رواتب وأجور' limit 1;
    v_src := case p_pay_source when 'drawer' then 'من الدرج' when 'bank' then 'بنك / كليك' else 'نقد خارج الدرج' end;
    insert into expenses (expense_date, category_id, amount, description, payment_type, from_drawer, created_by, payroll_payment_id)
    values ((now() at time zone 'Asia/Amman')::date, v_cat, p_net,
            'راتب ' || coalesce(v_name, '') || ' (' || p_start || ' لـ ' || p_end || ') · ' || v_src,
            'cash', p_pay_source = 'drawer', auth.uid(), v_id)
    on conflict do nothing;
  end if;
  return v_id;
end;
$$;

revoke all on function public.record_payroll_payment(uuid, uuid, date, date, numeric, numeric, numeric, numeric, numeric, text, uuid[], uuid[], date, text) from public, anon;
grant execute on function public.record_payroll_payment(uuid, uuid, date, date, numeric, numeric, numeric, numeric, numeric, text, uuid[], uuid[], date, text) to authenticated;

notify pgrst, 'reload schema';
