-- قاعدة بيانات العملاء (2026-10): نفس جدول customers الموجود، بس مرتّب وكامل:
--  1) الرقم بينحفظ دايمًا بصيغة وحدة (07XXXXXXXX) فما بيتكرر الزبون لو انكتب
--     +962 أو 00962 أو بمسافات.
--  2) حقول ملف الزبون: تاريخ الميلاد، العنوان، ملاحظات، مصدره، وموافقته على الرسائل.
--  3) تعبئة رجعية من المبيعات القديمة (زباين كانوا مسجّلين ببيع بس مش بالجدول).
--  4) دالة rebuild_customer_stats() بترجّع حساب الزيارات/المبلغ/النقاط من المبيعات
--     المكتملة لو صار أي فرق.
-- كل الأوامر قابلة للتكرار (idempotent) وإضافية: ما في حذف ولا drop.

-- ============ 1) توحيد صيغة الرقم ============
create or replace function public.normalize_phone(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if d = '' then
    return null;
  end if;
  if d like '00962%' then
    d := '0' || substr(d, 6);
  elsif d like '962%' and length(d) = 12 then
    d := '0' || substr(d, 4);
  elsif length(d) = 9 and d like '7%' then
    d := '0' || d;
  end if;
  return d;
end;
$$;

-- ============ 2) أعمدة ملف الزبون ============
alter table public.customers add column if not exists birthday date;
alter table public.customers add column if not exists address text;
alter table public.customers add column if not exists notes text;
alter table public.customers add column if not exists source text not null default 'pos';
alter table public.customers add column if not exists marketing_ok boolean not null default true;
alter table public.customers add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_source_check') then
    alter table public.customers
      add constraint customers_source_check check (source in ('pos', 'menu', 'manual', 'reservation'));
  end if;
end $$;

-- ============ 3) تطبيع تلقائي عند أي كتابة ============
create or replace function public._customers_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.phone := coalesce(public.normalize_phone(new.phone), new.phone);
  new.name := nullif(trim(coalesce(new.name, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public._sales_normalize_phone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.customer_phone is not null then
    new.customer_phone := public.normalize_phone(new.customer_phone);
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'customers_before_write' and tgrelid = 'public.customers'::regclass) then
    create trigger customers_before_write before insert or update on public.customers
      for each row execute function public._customers_before_write();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sales_normalize_phone' and tgrelid = 'public.sales_entries'::regclass) then
    create trigger sales_normalize_phone before insert on public.sales_entries
      for each row execute function public._sales_normalize_phone();
  end if;
end $$;

-- سجل مبيعات الزبون بيدور برقمه كتير
create index if not exists sales_entries_customer_phone_idx
  on public.sales_entries (customer_phone) where customer_phone is not null;

-- ============ 4) دالة الولاء بتحفظ الرقم موحّد ============
-- نفس التوقيع بالضبط (create or replace بدون drop)
create or replace function public._loyalty_apply(
  p_phone text,
  p_name text,
  p_visit_delta integer,
  p_spent_delta numeric,
  p_points_delta integer
) returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
begin
  if v_phone is null then
    return;
  end if;

  insert into public.customers (phone, name, visit_count, total_spent, points_balance, last_visit_at)
  values (
    v_phone,
    nullif(trim(coalesce(p_name, '')), ''),
    greatest(p_visit_delta, 0),
    greatest(p_spent_delta, 0),
    greatest(p_points_delta, 0),
    case when p_visit_delta > 0 then now() else null end
  )
  on conflict (phone) do update set
    name = coalesce(nullif(trim(coalesce(excluded.name, '')), ''), public.customers.name),
    visit_count = greatest(public.customers.visit_count + p_visit_delta, 0),
    total_spent = greatest(public.customers.total_spent + p_spent_delta, 0),
    points_balance = greatest(public.customers.points_balance + p_points_delta, 0),
    last_visit_at = case when p_visit_delta > 0 then now() else public.customers.last_visit_at end;
end;
$$;

-- ============ 5) إعادة حساب من المبيعات المكتملة ============
-- بتضيف الزباين الناقصين وبتصحّح الزيارات/المبلغ/النقاط (نقطة لكل دينار كامل
-- بكل طلب، نفس منطق الولاء). للمدير فقط (أو من محرر SQL).
create or replace function public.rebuild_customer_stats()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'للمدير فقط';
  end if;

  with s as (
    select
      public.normalize_phone(customer_phone) as phone,
      (array_agg(nullif(trim(customer_name), '') order by created_at desc)
        filter (where nullif(trim(customer_name), '') is not null))[1] as name,
      count(*) as visits,
      sum(coalesce(cash_amount, 0) + coalesce(card_amount, 0) + coalesce(delivery_amount, 0)) as spent,
      sum(floor(coalesce(cash_amount, 0) + coalesce(card_amount, 0) + coalesce(delivery_amount, 0)))::integer as points,
      min(created_at) as first_at,
      max(created_at) as last_at
    from public.sales_entries
    where status = 'completed' and public.normalize_phone(customer_phone) is not null
    group by 1
  )
  insert into public.customers (phone, name, visit_count, total_spent, points_balance, created_at, last_visit_at)
  select phone, name, visits, spent, points, first_at, last_at from s
  on conflict (phone) do update set
    name = coalesce(public.customers.name, excluded.name),
    visit_count = excluded.visit_count,
    total_spent = excluded.total_spent,
    points_balance = excluded.points_balance,
    created_at = least(public.customers.created_at, excluded.created_at),
    last_visit_at = excluded.last_visit_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.rebuild_customer_stats() from public, anon;
grant execute on function public.rebuild_customer_stats() to authenticated;

-- تعبئة مرة وحدة هلأ
select public.rebuild_customer_stats();
