-- تنبيه الويتر لطاولة تأخّرت (2026-11-06). الكاشير/المدير بيضغط «نبّه الويتر» على الطاولة،
-- والويتر بيشوف التنبيه عالتابلت وبيرد بسبب التأخير (سبب جاهز أو نص حر)، والرد بيرجع للكاشير.
-- الجدول مقفول (RLS شغّال بدون سياسات): كل الوصول من الدوال تحت بس. آمن لو انعاد تشغيله.

create table if not exists public.table_nudges (
  id          uuid primary key default gen_random_uuid(),
  table_number text not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  status      text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  reply_code  text,
  reply_text  text,
  replied_by  uuid,
  replied_at  timestamptz
);
alter table public.table_nudges enable row level security;
create index if not exists table_nudges_status_idx on public.table_nudges (status, created_at desc);

-- الكاشير/المدير/المالك: نبّه الويتر. لو في تنبيه مفتوح لنفس الطاولة بآخر 10 دقايق بيرجّعه بدل ما يكرّر.
create or replace function public.nudge_table(p_table text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_t text := btrim(coalesce(p_table, ''));
begin
  if public.auth_role() is null then raise exception 'غير مصرّح'; end if;
  if v_t = '' then raise exception 'رقم الطاولة فاضي'; end if;
  select id into v_id from public.table_nudges
   where status = 'open' and lower(table_number) = lower(v_t) and created_at > now() - interval '10 minutes'
   order by created_at desc limit 1;
  if v_id is null then
    insert into public.table_nudges (table_number) values (v_t) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- الكاشير: التنبيهات المفتوحة والمردودة (آخر 6 ساعات) مع اسم الويتر اللي ردّ
create or replace function public.table_nudges_active()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.auth_role() is null then raise exception 'غير مصرّح'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'table_number', n.table_number, 'status', n.status, 'created_at', n.created_at,
      'reply_code', n.reply_code, 'reply_text', n.reply_text, 'replied_at', n.replied_at,
      'waiter', p.full_name) order by n.created_at)
    from public.table_nudges n
    left join public.profiles p on p.id = n.replied_by
    where n.status in ('open', 'answered') and n.created_at > now() - interval '6 hours'
  ), '[]'::jsonb);
end;
$$;

-- الكاشير: شفت الرد، شيل التنبيه
create or replace function public.dismiss_table_nudge(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.auth_role() is null then raise exception 'غير مصرّح'; end if;
  update public.table_nudges set status = 'dismissed' where id = p_id and status in ('open', 'answered');
end;
$$;

-- الويتر: التنبيهات المفتوحة (آخر 3 ساعات)
create or replace function public.waiter_nudges()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'table_number', n.table_number, 'created_at', n.created_at) order by n.created_at)
    from public.table_nudges n
    where n.status = 'open' and n.created_at > now() - interval '3 hours'
  ), '[]'::jsonb);
end;
$$;

-- الويتر: رد بسبب التأخير (سبب جاهز p_code و/أو نص حر p_text)
create or replace function public.waiter_reply_nudge(p_id uuid, p_code text, p_text text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_code text := nullif(btrim(coalesce(p_code, '')), ''); v_text text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  if v_code is null and v_text is null then raise exception 'اختار سبب أو اكتب جواب'; end if;
  update public.table_nudges
     set status = 'answered', reply_code = v_code, reply_text = left(v_text, 200), replied_by = auth.uid(), replied_at = now()
   where id = p_id and status = 'open';
end;
$$;

revoke execute on function public.nudge_table(text), public.table_nudges_active(), public.dismiss_table_nudge(uuid),
  public.waiter_nudges(), public.waiter_reply_nudge(uuid, text, text) from public, anon;
grant execute on function public.nudge_table(text), public.table_nudges_active(), public.dismiss_table_nudge(uuid),
  public.waiter_nudges(), public.waiter_reply_nudge(uuid, text, text) to authenticated;
