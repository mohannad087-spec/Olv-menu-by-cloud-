-- الموارد البشرية: الإنذارات والخصومات والمكافآت لكل موظف + سجل تدقيق (مين عدّل شو ومتى).
-- كل شي للمالك والمدير فقط (الكاشير ما بيشوف ولا بيكتب). الكتابة كلها عبر دوال بقفل صفوف
-- (hr_create_record / hr_update_record / hr_cancel_record) مش من المتصفح مباشرة.
-- الخصم المالي والمكافأة بيتحولوا تلقائياً لبند بـ payroll_adjustments (سالب/موجب) وسببه ظاهر بكشف الراتب.

create table if not exists public.hr_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('warning_verbal', 'warning_written', 'warning_final', 'deduction', 'bonus')),
  reason_code text not null default 'other',   -- late, absence, misconduct, performance, hygiene, customer, bonus_month, bonus_commit, other
  reason_text text,
  amount numeric(10,2) not null default 0,      -- إجمالي الخصم أو المكافأة بالدينار (للإنذارات 0)
  fixed_amount numeric(10,2) not null default 0,
  deduct_days numeric(5,2) not null default 0,
  day_value numeric(10,2) not null default 0,
  record_date date not null default current_date,
  notes text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'auto')),
  suggest_key text,
  adjustment_id uuid references public.payroll_adjustments(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text
);
create index if not exists hr_records_profile_idx on public.hr_records (profile_id, record_date desc);
create index if not exists hr_records_adj_idx on public.hr_records (adjustment_id);
create index if not exists hr_records_created_by_idx on public.hr_records (created_by);
create unique index if not exists hr_records_suggest_uidx on public.hr_records (profile_id, suggest_key) where suggest_key is not null and status = 'active';

create table if not exists public.hr_audit (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.hr_records(id) on delete cascade,
  action text not null,               -- create, update, cancel
  details jsonb,
  by_user uuid references public.profiles(id),
  at timestamptz not null default now()
);
create index if not exists hr_audit_record_idx on public.hr_audit (record_id, at);
create index if not exists hr_audit_by_idx on public.hr_audit (by_user);

create table if not exists public.hr_dismissed (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  suggest_key text not null,
  by_user uuid references public.profiles(id),
  at timestamptz not null default now(),
  primary key (profile_id, suggest_key)
);
create index if not exists hr_dismissed_by_idx on public.hr_dismissed (by_user);

alter table public.payroll_adjustments add column if not exists hr_record_id uuid;

alter table public.hr_records enable row level security;
alter table public.hr_audit enable row level security;
alter table public.hr_dismissed enable row level security;

drop policy if exists hr_records_select on public.hr_records;
create policy hr_records_select on public.hr_records for select using ((select public.is_admin()));
drop policy if exists hr_audit_select on public.hr_audit;
create policy hr_audit_select on public.hr_audit for select using ((select public.is_admin()));
drop policy if exists hr_dismissed_all on public.hr_dismissed;
create policy hr_dismissed_all on public.hr_dismissed for all using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.hr_records, public.hr_audit from anon, authenticated;
grant select on public.hr_records, public.hr_audit to authenticated;
revoke all on public.hr_dismissed from anon;
grant select, insert, delete on public.hr_dismissed to authenticated;

-- إنشاء سجل. p_kind = 'warning' يعني «إنذار بالتصعيد التلقائي»: أول إنذار شفهي، ثاني خطي، ثالث نهائي
-- (بيحسب الإنذارات الفعّالة آخر 12 شهر). الخصم = مبلغ ثابت + (أيام × قيمة اليوم).
create or replace function public.hr_create_record(
  p_profile uuid, p_kind text, p_reason_code text, p_reason_text text,
  p_fixed numeric default 0, p_days numeric default 0, p_day_value numeric default 0,
  p_date date default current_date, p_notes text default null,
  p_source text default 'manual', p_suggest_key text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_kind text := p_kind;
  v_total numeric := 0;
  v_id uuid := gen_random_uuid();
  v_adj uuid;
  v_label text;
  v_n int;
begin
  if not public.is_admin() then raise exception 'غير مسموح: للمالك والمدير فقط'; end if;
  if not exists (select 1 from public.profiles where id = p_profile) then raise exception 'الموظف غير موجود'; end if;
  perform pg_advisory_xact_lock(hashtext('hr:' || p_profile::text));

  if v_kind = 'warning' then
    select count(*) into v_n from public.hr_records
      where profile_id = p_profile and status = 'active' and kind like 'warning_%' and record_date > current_date - 365;
    v_kind := case when v_n = 0 then 'warning_verbal' when v_n = 1 then 'warning_written' else 'warning_final' end;
  end if;
  if v_kind not in ('warning_verbal', 'warning_written', 'warning_final', 'deduction', 'bonus') then
    raise exception 'نوع غير معروف';
  end if;
  if coalesce(p_fixed, 0) < 0 or coalesce(p_days, 0) < 0 or coalesce(p_day_value, 0) < 0 then raise exception 'القيم لازم تكون موجبة'; end if;
  if v_kind = 'deduction' then
    v_total := round(coalesce(p_fixed, 0) + coalesce(p_days, 0) * coalesce(p_day_value, 0), 2);
    if v_total <= 0 then raise exception 'حدد مبلغ الخصم أو عدد الأيام'; end if;
  elsif v_kind = 'bonus' then
    v_total := round(coalesce(p_fixed, 0), 2);
    if v_total <= 0 then raise exception 'حدد مبلغ المكافأة'; end if;
  end if;

  insert into public.hr_records (id, profile_id, kind, reason_code, reason_text, amount, fixed_amount, deduct_days, day_value,
                                 record_date, notes, source, suggest_key, created_by)
  values (v_id, p_profile, v_kind, coalesce(nullif(p_reason_code, ''), 'other'), nullif(trim(p_reason_text), ''), v_total,
          case when v_kind = 'deduction' then coalesce(p_fixed, 0) else v_total end,
          case when v_kind = 'deduction' then coalesce(p_days, 0) else 0 end,
          case when v_kind = 'deduction' then coalesce(p_day_value, 0) else 0 end,
          coalesce(p_date, current_date), nullif(trim(p_notes), ''),
          case when p_source = 'auto' then 'auto' else 'manual' end, nullif(p_suggest_key, ''), auth.uid());

  if v_kind in ('deduction', 'bonus') then
    v_label := case when v_kind = 'deduction' then 'خصم: ' else 'مكافأة: ' end
      || coalesce(nullif(trim(p_reason_text), ''), 'بدون تفاصيل');
    insert into public.payroll_adjustments (profile_id, amount, adj_date, note, created_by, hr_record_id)
    values (p_profile, case when v_kind = 'deduction' then -v_total else v_total end, coalesce(p_date, current_date), v_label, auth.uid(), v_id)
    returning id into v_adj;
    update public.hr_records set adjustment_id = v_adj where id = v_id;
  end if;

  insert into public.hr_audit (record_id, action, details, by_user)
  values (v_id, 'create', jsonb_build_object('kind', v_kind, 'amount', v_total, 'reason', p_reason_code, 'source', p_source), auth.uid());
  return v_id;
end;
$$;

-- تعديل سبب/مبلغ/تاريخ/ملاحظة. ما بينعدّل خصم انحسب بدفعة راتب.
create or replace function public.hr_update_record(
  p_id uuid, p_reason_code text, p_reason_text text,
  p_fixed numeric, p_days numeric, p_day_value numeric, p_date date, p_notes text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.hr_records;
  v_total numeric;
  v_label text;
begin
  if not public.is_admin() then raise exception 'غير مسموح: للمالك والمدير فقط'; end if;
  select * into r from public.hr_records where id = p_id for update;
  if not found then raise exception 'السجل غير موجود'; end if;
  if r.status <> 'active' then raise exception 'السجل ملغي'; end if;
  if r.adjustment_id is not null and exists (select 1 from public.payroll_adjustments a where a.id = r.adjustment_id and a.settled_payroll_id is not null) then
    raise exception 'هالبند انحسب بدفعة راتب ما بينعدّل';
  end if;
  v_total := r.amount;
  if r.kind = 'deduction' then
    v_total := round(coalesce(p_fixed, 0) + coalesce(p_days, 0) * coalesce(p_day_value, 0), 2);
    if v_total <= 0 then raise exception 'حدد مبلغ الخصم أو عدد الأيام'; end if;
  elsif r.kind = 'bonus' then
    v_total := round(coalesce(p_fixed, 0), 2);
    if v_total <= 0 then raise exception 'حدد مبلغ المكافأة'; end if;
  end if;
  update public.hr_records set
    reason_code = coalesce(nullif(p_reason_code, ''), reason_code),
    reason_text = nullif(trim(p_reason_text), ''),
    amount = v_total,
    fixed_amount = case when kind = 'deduction' then coalesce(p_fixed, 0) when kind = 'bonus' then v_total else 0 end,
    deduct_days = case when kind = 'deduction' then coalesce(p_days, 0) else 0 end,
    day_value = case when kind = 'deduction' then coalesce(p_day_value, 0) else 0 end,
    record_date = coalesce(p_date, record_date),
    notes = nullif(trim(p_notes), ''),
    updated_by = auth.uid(), updated_at = now()
  where id = p_id;
  if r.adjustment_id is not null then
    v_label := case when r.kind = 'deduction' then 'خصم: ' else 'مكافأة: ' end || coalesce(nullif(trim(p_reason_text), ''), 'بدون تفاصيل');
    update public.payroll_adjustments
      set amount = case when r.kind = 'deduction' then -v_total else v_total end,
          adj_date = coalesce(p_date, adj_date), note = v_label
      where id = r.adjustment_id;
  end if;
  insert into public.hr_audit (record_id, action, details, by_user)
  values (p_id, 'update', jsonb_build_object(
    'old', jsonb_build_object('amount', r.amount, 'reason', r.reason_code, 'text', r.reason_text, 'date', r.record_date, 'notes', r.notes),
    'new', jsonb_build_object('amount', v_total, 'reason', p_reason_code, 'text', p_reason_text, 'date', p_date, 'notes', p_notes)), auth.uid());
end;
$$;

-- إلغاء سجل (بيضل ظاهر بالسجل كـ«ملغي» مع السبب ومين ألغاه). لو الخصم انحسب برواتب ما بيتلغى.
create or replace function public.hr_cancel_record(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare r public.hr_records;
begin
  if not public.is_admin() then raise exception 'غير مسموح: للمالك والمدير فقط'; end if;
  select * into r from public.hr_records where id = p_id for update;
  if not found then raise exception 'السجل غير موجود'; end if;
  if r.status = 'cancelled' then return; end if;
  if r.adjustment_id is not null then
    if exists (select 1 from public.payroll_adjustments a where a.id = r.adjustment_id and a.settled_payroll_id is not null) then
      raise exception 'هالبند انحسب بدفعة راتب ما بينلغى. سجّل بند عكسي من الرواتب';
    end if;
    delete from public.payroll_adjustments where id = r.adjustment_id;
  end if;
  update public.hr_records set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
    cancel_reason = nullif(trim(p_reason), ''), adjustment_id = null where id = p_id;
  insert into public.hr_audit (record_id, action, details, by_user)
  values (p_id, 'cancel', jsonb_build_object('reason', p_reason, 'amount', r.amount), auth.uid());
end;
$$;

revoke all on function public.hr_create_record(uuid, text, text, text, numeric, numeric, numeric, date, text, text, text) from public, anon;
revoke all on function public.hr_update_record(uuid, text, text, numeric, numeric, numeric, date, text) from public, anon;
revoke all on function public.hr_cancel_record(uuid, text) from public, anon;
grant execute on function public.hr_create_record(uuid, text, text, text, numeric, numeric, numeric, date, text, text, text) to authenticated;
grant execute on function public.hr_update_record(uuid, text, text, numeric, numeric, numeric, date, text) to authenticated;
grant execute on function public.hr_cancel_record(uuid, text) to authenticated;

notify pgrst, 'reload schema';
