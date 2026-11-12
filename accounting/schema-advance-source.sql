-- السلفة بتنسجّل كمان كمصروف «رواتب وأجور» وبنختار من وين انعطت: الدرج، نقد خارج الدرج، أو بنك/كليك.
-- المصروف بيتبع السلفة (تعديل المصدر بيعدّله، حذف السلفة بيحذفه). السلف القديمة مصدرها «غير محدد» لحد ما تنختار.
-- ما في ازدواج: مصروف الراتب بيسجّل الصافي بس (بعد خصم السلف). آمن للتشغيل أكتر من مرة.

alter table public.salary_advances add column if not exists pay_source text;
alter table public.salary_advances add column if not exists expense_id uuid references public.expenses(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salary_advances_pay_source_chk') then
    alter table public.salary_advances add constraint salary_advances_pay_source_chk check (pay_source is null or pay_source in ('drawer', 'cash', 'bank'));
  end if;
end $$;

-- يضبط مصروف السلفة حسب المصدر (null = بدون مصروف)
create or replace function public.set_salary_advance_source(p_advance uuid, p_source text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  a salary_advances%rowtype;
  v_name text;
  v_cat uuid;
  v_src text;
  v_desc text;
  v_exp uuid;
begin
  if p_source is not null and p_source not in ('drawer', 'cash', 'bank') then
    raise exception 'مصدر غير معروف' using errcode = '22023';
  end if;
  select * into a from salary_advances where id = p_advance for update;
  if not found then raise exception 'السلفة مش موجودة' using errcode = '22023'; end if;
  if a.settled_payroll_id is not null or a.paid_at is not null then
    raise exception 'السلفة انسوّت، ما بينفع تعدّل مصدرها' using errcode = '22023';
  end if;
  if a.kind <> 'advance' then
    raise exception 'هاي مش سلفة نقدية' using errcode = '22023';
  end if;

  if p_source is null then
    if a.expense_id is not null then
      update salary_advances set expense_id = null, pay_source = null where id = a.id;
      delete from expenses where id = a.expense_id;
    else
      update salary_advances set pay_source = null where id = a.id;
    end if;
    return;
  end if;

  select full_name into v_name from profiles where id = a.profile_id;
  select id into v_cat from expense_categories where name = 'رواتب وأجور' limit 1;
  v_src := case p_source when 'drawer' then 'من الدرج' when 'bank' then 'بنك / كليك' else 'نقد خارج الدرج' end;
  v_desc := 'سلفة ' || coalesce(v_name, '') || ' · ' || v_src;

  if a.expense_id is not null then
    update expenses set from_drawer = (p_source = 'drawer'), description = v_desc, amount = a.amount where id = a.expense_id;
  else
    insert into expenses (expense_date, category_id, amount, description, payment_type, from_drawer, created_by)
    values (a.advance_date, v_cat, a.amount, v_desc, 'cash', p_source = 'drawer', auth.uid())
    returning id into v_exp;
    update salary_advances set expense_id = v_exp where id = a.id;
  end if;
  update salary_advances set pay_source = p_source where id = a.id;
end;
$$;

-- سلفة جديدة + مصروفها بنفس العملية
create or replace function public.add_salary_advance(p_profile uuid, p_amount numeric, p_date date, p_note text, p_source text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ لازم يكون أكبر من صفر' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('drawer', 'cash', 'bank') then
    raise exception 'اختار من وين انعطت السلفة (الدرج، نقد خارجي، بنك/كليك)' using errcode = '22023';
  end if;
  insert into salary_advances (profile_id, amount, advance_date, note, created_by, kind)
  values (p_profile, p_amount, p_date, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), 'advance')
  returning id into v_id;
  perform public.set_salary_advance_source(v_id, p_source);
  return v_id;
end;
$$;

-- حذف السلفة مع مصروفها
create or replace function public.delete_salary_advance(p_advance uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_exp uuid;
begin
  select expense_id into v_exp from salary_advances where id = p_advance for update;
  delete from salary_advances where id = p_advance;
  if v_exp is not null then delete from expenses where id = v_exp; end if;
end;
$$;

revoke all on function public.set_salary_advance_source(uuid, text) from public, anon;
revoke all on function public.add_salary_advance(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.delete_salary_advance(uuid) from public, anon;
grant execute on function public.set_salary_advance_source(uuid, text) to authenticated;
grant execute on function public.add_salary_advance(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.delete_salary_advance(uuid) to authenticated;

notify pgrst, 'reload schema';
