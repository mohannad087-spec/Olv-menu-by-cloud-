-- ذمم الموظفين (طلبات «على حساب موظف» من الكاشير) — صفحة الذمم.
-- بنستعمل جدول السلف نفسه (salary_advances): الطلب بينسجّل كسلفة بتنخصم من الراتب تلقائيًا،
-- بس مربوطة بالبيعة وبنوعها، وممكن تتسدد كاش/بنك/كليك قبل الراتب (paid_at).
-- آمن للتشغيل أكثر من مرة.
alter table public.salary_advances add column if not exists sale_id uuid references public.sales_entries(id) on delete set null;
alter table public.salary_advances add column if not exists kind text not null default 'advance';
alter table public.salary_advances add column if not exists paid_at timestamptz;
alter table public.salary_advances add column if not exists paid_method text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'salary_advances_kind_chk') then
    alter table public.salary_advances add constraint salary_advances_kind_chk check (kind in ('advance', 'purchase'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salary_advances_paid_method_chk') then
    alter table public.salary_advances add constraint salary_advances_paid_method_chk check (paid_method is null or paid_method in ('cash', 'bank', 'click'));
  end if;
end $$;
create index if not exists salary_advances_sale_idx on public.salary_advances (sale_id);

-- الكاشير ما بيقدر يكتب بجدول السلف (RLS للمالك/المدير بس)، فالتسجيل بيمر من هالدالة:
-- بتقبل بيعة الكاشير نفسه خلال آخر 15 دقيقة، ومبلغ موجب، وموظف موجود.
create or replace function public.add_staff_charge(p_profile_id uuid, p_sale_id uuid, p_amount numeric, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_id uuid;
begin
  if v_role is null then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  if v_role not in ('owner', 'manager', 'staff') then raise exception 'غير مصرّح'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000 then raise exception 'مبلغ غير صالح'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then raise exception 'الموظف غير موجود'; end if;
  if not exists (
    select 1 from public.sales_entries s
    where s.id = p_sale_id
      and (v_role in ('owner', 'manager') or (s.created_by = auth.uid() and s.created_at > now() - interval '15 minutes'))
  ) then raise exception 'البيعة غير موجودة أو مش إلك'; end if;
  insert into public.salary_advances (profile_id, amount, advance_date, note, created_by, sale_id, kind)
  values (p_profile_id, round(p_amount, 2), current_date, left(p_note, 300), auth.uid(), p_sale_id, 'purchase')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_staff_charge(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.add_staff_charge(uuid, uuid, numeric, text) to authenticated;

-- الكاشير يحتاج يشوف أسماء الموظفين ليختار منهم (بدون أي بيانات حساسة)
create or replace function public.staff_names()
returns table (id uuid, full_name text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name from public.profiles p
  where public.auth_role() in ('owner', 'manager', 'staff') and coalesce(p.full_name, '') <> '' and coalesce(p.is_active, true)
  order by p.full_name;
$$;
revoke all on function public.staff_names() from public, anon;
grant execute on function public.staff_names() to authenticated;
