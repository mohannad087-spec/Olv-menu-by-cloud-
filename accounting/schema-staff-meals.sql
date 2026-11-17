-- وجبة الموظفين: كل موظف بصم اليوم إله وجبة وحدة (ساندويش + مشروب) بدون سعر ودفع.
-- اليوم بيبدأ الساعة 3:00 فجرًا بتوقيت عمّان (نفس يوم الطلبات). بتنطبع للمطبخ/البار بس، بدون فاتورة.
-- القوائم المسموحة بالإعدادات: app_settings.staff_meal_sandwiches / staff_meal_drinks (معرّفات أصناف مفصولة بفاصلة).
-- آمن للتشغيل أكثر من مرة.

-- يوم العمل (يتبدّل 3:00 فجرًا بتوقيت عمّان)
create or replace function public.olv_business_day(p_ts timestamptz default now())
returns date
language sql
immutable
as $$ select ((p_ts at time zone 'Asia/Amman') - interval '3 hours')::date $$;

create table if not exists public.staff_meals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  employee_name text not null,
  meal_day date not null,
  sale_id uuid references public.sales_entries(id) on delete set null,
  sandwich_name text,
  drink_name text,
  cost numeric(12,4) not null default 0,
  is_extra boolean not null default false,   -- وجبة ثانية بموافقة مدير
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists staff_meals_day_idx on public.staff_meals (meal_day, profile_id);
create index if not exists staff_meals_sale_idx on public.staff_meals (sale_id);
-- الوصول من الدوال تحت بس (security definer)
alter table public.staff_meals enable row level security;
revoke all on public.staff_meals from anon, authenticated;

-- الموظفين اللي بصموا اليوم + مين استلم وجبته (للكاشير)
create or replace function public.staff_meal_candidates()
returns table (id uuid, full_name text, first_punch timestamptz, meal_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day date := public.olv_business_day(now());
  v_from timestamptz := ((v_day::text || ' 03:00')::timestamp at time zone 'Asia/Amman');
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager', 'staff') then
    raise exception 'غير مصرّح';
  end if;
  return query
    select p.id, p.full_name::text, f.first_punch,
           (select max(m.created_at) from public.staff_meals m where m.profile_id = p.id and m.meal_day = v_day)
    from public.profiles p
    join lateral (
      select min(e.punched_at) as first_punch from public.employee_punches e
      where e.profile_id = p.id and e.punched_at >= v_from and e.punched_at < v_from + interval '1 day'
    ) f on f.first_punch is not null
    where coalesce(p.full_name, '') <> '' and coalesce(p.is_active, true)
    order by p.full_name;
end;
$$;
revoke all on function public.staff_meal_candidates() from public, anon;
grant execute on function public.staff_meal_candidates() to authenticated;

-- تسجيل الوجبة: بتعمل بيعة صفرية (بدون فاتورة) + تذاكر المطبخ/البار + خصم المخزون + تكلفة الوجبة
create or replace function public.record_staff_meal(
  p_profile_id uuid, p_sandwich_id uuid, p_drink_id uuid,
  p_client_ref uuid default null, p_override boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_day date := public.olv_business_day(now());
  v_from timestamptz := ((v_day::text || ' 03:00')::timestamp at time zone 'Asia/Amman');
  v_name text;
  v_sale uuid;
  v_ids text;
  v_prod record;
  v_pid uuid;
  v_cost numeric := 0;
  v_c numeric;
  v_sname text;
  v_dname text;
  v_last timestamptz;
  v_extra boolean := false;
  v_no int;
begin
  if v_role is null or v_role not in ('owner', 'manager', 'staff') then raise exception 'غير مصرّح'; end if;
  if p_client_ref is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));
    select id into v_sale from public.sales_entries where client_ref = p_client_ref;
    if v_sale is not null then
      return jsonb_build_object('sale_id', v_sale, 'order_no', (select order_no from public.sales_entries where id = v_sale));
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('staff_meal:' || p_profile_id::text, 0));

  select full_name into v_name from public.profiles where id = p_profile_id and coalesce(is_active, true);
  if v_name is null then raise exception 'الموظف غير موجود'; end if;
  if not exists (select 1 from public.employee_punches e
                 where e.profile_id = p_profile_id and e.punched_at >= v_from and e.punched_at < v_from + interval '1 day') then
    raise exception 'الموظف ما بصم اليوم';
  end if;

  -- القوائم المسموحة
  select value into v_ids from public.app_settings where key = 'staff_meal_sandwiches';
  if p_sandwich_id is null or not (p_sandwich_id::text = any (string_to_array(coalesce(v_ids, ''), ','))) then
    raise exception 'الساندويش مش من قائمة وجبة الموظفين';
  end if;
  select value into v_ids from public.app_settings where key = 'staff_meal_drinks';
  if p_drink_id is null or not (p_drink_id::text = any (string_to_array(coalesce(v_ids, ''), ','))) then
    raise exception 'المشروب مش من قائمة وجبة الموظفين';
  end if;

  -- وجبة وحدة باليوم
  select max(created_at) into v_last from public.staff_meals where profile_id = p_profile_id and meal_day = v_day;
  if v_last is not null then
    if not p_override then
      raise exception 'استلم وجبته الساعة %', to_char(v_last at time zone 'Asia/Amman', 'HH12:MI AM');
    end if;
    if v_role = 'staff' and not public._consume_approval('discount') then
      raise exception 'وجبة ثانية بنفس اليوم — يحتاج موافقة مدير';
    end if;
    v_extra := true;
  end if;

  insert into public.sales_entries (entry_date, cash_amount, card_amount, delivery_amount, notes, order_type,
                                    customer_name, created_by, discount_amount, client_ref)
  values (v_day, 0, 0, 0, 'وجبة موظف — ' || v_name, 'وجبة موظف', left(v_name, 120), auth.uid(), 0, p_client_ref)
  returning id into v_sale;

  foreach v_pid in array array[p_sandwich_id, p_drink_id] loop
    select * into v_prod from public.products where id = v_pid;
    if not found then raise exception 'صنف غير موجود'; end if;
    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, note, addons_total)
    values (v_sale, v_pid, v_prod.name, 1, 0, case when v_pid = p_sandwich_id then 'وجبة موظف — مع بطاطا' else 'وجبة موظف' end, 0);
    update public.ingredients i set current_stock = i.current_stock - pi.quantity
      from public.product_ingredients pi where pi.product_id = v_pid and pi.ingredient_id = i.id;
    select coalesce(v_prod.cost_manual,
             (select sum(pi.quantity * coalesce(i.unit_price, 0)) from public.product_ingredients pi
                join public.ingredients i on i.id = pi.ingredient_id where pi.product_id = v_pid), 0) into v_c;
    v_cost := v_cost + coalesce(v_c, 0);
    if v_pid = p_sandwich_id then v_sname := v_prod.name; else v_dname := v_prod.name; end if;
  end loop;

  insert into public.staff_meals (profile_id, employee_name, meal_day, sale_id, sandwich_name, drink_name, cost, is_extra, created_by)
  values (p_profile_id, v_name, v_day, v_sale, v_sname, v_dname, round(v_cost, 4), v_extra, auth.uid());

  -- تذاكر المطبخ/البار بس، بدون فاتورة زبون
  insert into public.print_jobs (sale_id, job_type) values (v_sale, 'kitchen');

  insert into public.audit_log (actor, actor_name, table_name, op, row_id, new_data)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), 'staff_meals', 'INSERT', v_sale::text,
          jsonb_build_object('employee', v_name, 'sandwich', v_sname, 'drink', v_dname, 'extra', v_extra));

  select order_no into v_no from public.sales_entries where id = v_sale;
  return jsonb_build_object('sale_id', v_sale, 'order_no', v_no);
end;
$$;
revoke all on function public.record_staff_meal(uuid, uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.record_staff_meal(uuid, uuid, uuid, uuid, boolean) to authenticated;

-- تقرير الوجبات (مالك/مدير بس): كل وجبة بسطر، الملغاة مستثناة
create or replace function public.staff_meals_report(p_from date, p_to date)
returns table (meal_day date, profile_id uuid, employee_name text, meal_at timestamptz,
               sandwich_name text, drink_name text, cost numeric, is_extra boolean, order_no integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'غير مصرّح';
  end if;
  return query
    select m.meal_day, m.profile_id, m.employee_name, m.created_at, m.sandwich_name, m.drink_name,
           m.cost, m.is_extra, s.order_no
    from public.staff_meals m
    left join public.sales_entries s on s.id = m.sale_id
    where m.meal_day between p_from and p_to and coalesce(s.status, 'completed') <> 'voided'
    order by m.meal_day desc, m.created_at desc;
end;
$$;
revoke all on function public.staff_meals_report(date, date) from public, anon;
grant execute on function public.staff_meals_report(date, date) to authenticated;
