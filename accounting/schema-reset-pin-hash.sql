-- تشفير رقم «إعادة التصفير» السري (bcrypt) بدل ما يتخزن نص عادي بـ app_settings.
-- الدوال بتقبل الرقم القديم النص العادي لو لسا موجود، وأي تغيير جديد بيتخزن مشفّر.
create extension if not exists pgcrypto with schema extensions;

update public.app_settings
   set value = extensions.crypt(value, extensions.gen_salt('bf'))
 where key = 'reset_pin' and value !~ '^\$2[aby]\$';

create or replace function public._check_reset_pin(p_pin text)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pin text;
  v_fails int;
  v_ok boolean;
begin
  if not public.is_admin() then
    raise exception 'منطقة الخطر للمالك والمدير فقط';
  end if;
  select count(*) into v_fails from public.pin_attempts
   where user_id = auth.uid() and not ok and created_at > now() - interval '15 minutes';
  if v_fails >= 5 then
    raise exception 'محاولات كثيرة غلط — جرّب بعد ربع ساعة';
  end if;
  select value into v_pin from public.app_settings where key = 'reset_pin';
  if p_pin is null then
    v_ok := false;
  elsif v_pin is null then
    v_ok := (p_pin = '1234');
  elsif v_pin ~ '^\$2[aby]\$' then
    v_ok := (extensions.crypt(p_pin, v_pin) = v_pin);
  else
    v_ok := (p_pin = v_pin);
  end if;
  if not v_ok then
    insert into public.pin_attempts (ok) values (false);
    return false;
  end if;
  insert into public.pin_attempts (ok) values (true);
  delete from public.pin_attempts where created_at < now() - interval '30 days';
  return true;
end;
$function$;

create or replace function public.set_reset_pin(p_old text, p_new text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pin text;
  v_ok boolean;
begin
  if not public.is_owner() then
    raise exception 'تغيير الرقم السري لصاحب المطعم فقط';
  end if;
  select value into v_pin from public.app_settings where key = 'reset_pin';
  if p_old is null then
    v_ok := false;
  elsif v_pin is null then
    v_ok := (p_old = '1234');
  elsif v_pin ~ '^\$2[aby]\$' then
    v_ok := (extensions.crypt(p_old, v_pin) = v_pin);
  else
    v_ok := (p_old = v_pin);
  end if;
  if not v_ok then
    raise exception 'الرقم السري الحالي غير صحيح';
  end if;
  if p_new is null or length(p_new) < 4 then
    raise exception 'الرقم السري الجديد لازم يكون 4 خانات على الأقل';
  end if;
  insert into public.app_settings (key, value)
  values ('reset_pin', extensions.crypt(p_new, extensions.gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
end;
$function$;

revoke all on function public._check_reset_pin(text) from public, anon, authenticated;
revoke execute on function public.set_reset_pin(text, text) from public, anon;
grant execute on function public.set_reset_pin(text, text) to authenticated;
