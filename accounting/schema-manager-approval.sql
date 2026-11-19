-- موافقة المدير برمز: الكاشير بيدخل رمز المدير على جهازه وبيكمّل الإلغاء أو الخصم الزايد، بدون ما المدير يسجّل دخول.
-- كل مدير/مالك بيحط رمزه الخاص (4-8 أرقام) من الإعدادات > الأمان، فبيتسجّل مين وافق بالضبط.
-- الرمز بيتخزّن مشفّر (SHA-256 مع salt) بجدول ما حدا بيقراه من المتصفح. 5 محاولات غلط بربع ساعة = قفل ربع ساعة.
-- الموافقة بتنفع لعملية وحدة بس، لحد 3 دقايق، ولنوع واحد: 'void' (إلغاء طلب/صنف بعد مهلة الكاشير أو لطلب مو إله) أو 'discount' (خصم فوق حد الكاشير).
-- بنعدّل شروط الكاشير داخل الدوال الموجودة (void_sale, void_sale_item, record_sale, add_items_to_sale, settle_table_tab)
-- بإضافة «إلا لو في موافقة صالحة» بدون ما نعيد كتابتها. السبب الإلزامي والتسجيل بسجل التدقيق بيضلوا. آمن لإعادة التشغيل.

create table if not exists public.manager_pins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  salt text not null,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.manager_pins enable row level security;
revoke all on public.manager_pins from anon, authenticated;

create table if not exists public.approval_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists approval_attempts_user_idx on public.approval_attempts (user_id, created_at desc);
alter table public.approval_attempts enable row level security;
revoke all on public.approval_attempts from anon, authenticated;

create table if not exists public.approvals (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  for_user uuid not null,
  kind text not null check (kind in ('void', 'discount')),
  approved_by uuid not null,
  approved_by_name text,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists approvals_open_idx on public.approvals (for_user, kind) where used_at is null;
alter table public.approvals enable row level security;
revoke all on public.approvals from anon, authenticated;

-- المدير/المالك بيحط رمزه
create or replace function public.set_my_manager_pin(p_pin text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_salt text := gen_random_uuid()::text;
begin
  if not public.is_admin() then
    raise exception 'الرمز للمالك والمدير فقط';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'الرمز لازم يكون من 4 لـ 8 أرقام';
  end if;
  insert into public.manager_pins (user_id, salt, pin_hash)
  values (auth.uid(), v_salt, encode(sha256(convert_to(v_salt || p_pin, 'utf8')), 'hex'))
  on conflict (user_id) do update set salt = excluded.salt, pin_hash = excluded.pin_hash, updated_at = now();
end;
$$;

create or replace function public.has_manager_pin()
returns boolean
language sql stable
security definer set search_path = public
as $$ select exists (select 1 from public.manager_pins where user_id = auth.uid()) $$;

-- الكاشير بيدخل رمز المدير: بيرجّع وقت انتهاء الموافقة، أو null لو الرمز غلط
create or replace function public.request_approval(p_pin text, p_kind text)
returns timestamptz
language plpgsql
security definer set search_path = public
as $$
declare
  v_fails int;
  v_mgr record;
  v_exp timestamptz := now() + interval '3 minutes';
  v_id bigint;
begin
  if public.auth_role() is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if p_kind not in ('void', 'discount') then
    raise exception 'نوع موافقة غير معروف';
  end if;
  select count(*) into v_fails from public.approval_attempts
   where user_id = auth.uid() and not ok and created_at > now() - interval '15 minutes';
  if v_fails >= 5 then
    raise exception 'محاولات كثيرة غلط — جرّب بعد ربع ساعة';
  end if;

  select mp.user_id, pr.full_name into v_mgr
  from public.manager_pins mp
  join public.profiles pr on pr.id = mp.user_id and pr.role in ('owner', 'manager') and pr.is_active is not false
  where p_pin is not null
    and mp.pin_hash = encode(sha256(convert_to(mp.salt || p_pin, 'utf8')), 'hex')
  limit 1;

  if v_mgr.user_id is null then
    insert into public.approval_attempts (ok) values (false);
    return null;
  end if;

  insert into public.approval_attempts (ok) values (true);
  delete from public.approval_attempts where created_at < now() - interval '30 days';
  insert into public.approvals (for_user, kind, approved_by, approved_by_name, expires_at)
  values (auth.uid(), p_kind, v_mgr.user_id, v_mgr.full_name, v_exp)
  returning id into v_id;

  insert into public.audit_log (actor, actor_name, table_name, op, row_id, new_data)
  values (
    auth.uid(),
    (select full_name from public.profiles where id = auth.uid()),
    'approvals', 'APPROVE', v_id::text,
    jsonb_build_object('kind', p_kind, 'approved_by', v_mgr.full_name)
  );
  return v_exp;
end;
$$;

-- بتستهلكها دوال الإلغاء والخصم: موافقة وحدة صالحة = true ومنخلّيها مستعملة
create or replace function public._consume_approval(p_kind text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null then return false; end if;
  update public.approvals set used_at = now()
   where id = (
     select id from public.approvals
      where for_user = auth.uid() and kind = p_kind and used_at is null and expires_at > now()
      order by created_at desc limit 1 for update skip locked
   )
  returning id into v_id;
  return v_id is not null;
end;
$$;

revoke execute on function public.set_my_manager_pin(text) from public, anon;
revoke execute on function public.has_manager_pin() from public, anon;
revoke execute on function public.request_approval(text, text) from public, anon;
revoke execute on function public._consume_approval(text) from public, anon, authenticated;
grant execute on function public.set_my_manager_pin(text) to authenticated;
grant execute on function public.has_manager_pin() to authenticated;
grant execute on function public.request_approval(text, text) to authenticated;

-- ربط الموافقة بالدوال: نبدّل الشرط داخل كل دالة (ما بنعيد كتابتها)
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('public.void_sale(uuid, text)',         'if v_role = ''staff'' then',                    'if v_role = ''staff'' and not public._consume_approval(''void'') then'),
      ('public.void_sale_item(uuid, text)',    'if v_role = ''staff'' then',                    'if v_role = ''staff'' and not public._consume_approval(''void'') then'),
      ('public.record_sale(date, numeric, numeric, numeric, text, jsonb, uuid, text, numeric, numeric, text, text, text)',
                                               'if v_discount > 0 and v_role = ''staff'' then', 'if v_discount > 0 and v_role = ''staff'' and not public._consume_approval(''discount'') then'),
      ('public.add_items_to_sale(uuid, jsonb, numeric, numeric, numeric, uuid)',
                                               'if v_discount > 0 and v_role = ''staff'' then', 'if v_discount > 0 and v_role = ''staff'' and not public._consume_approval(''discount'') then'),
      ('public.settle_table_tab(uuid[], numeric, numeric, numeric, date, numeric)',
                                               'if v_disc > 0 and v_role = ''staff'' then',     'if v_disc > 0 and v_role = ''staff'' and not public._consume_approval(''discount'') then')
    ) as t(fn, old_s, new_s)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if v_def like '%_consume_approval%' then
      continue; -- معدّلة أصلًا
    end if;
    v_new := replace(v_def, r.old_s, r.new_s);
    if v_new = v_def then
      raise exception 'ما لقيت الشرط بـ %', r.fn;
    end if;
    execute v_new;
  end loop;
end $$;
