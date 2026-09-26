-- إدارة الموظفين: بيانات إضافية لكل موظف (هاتف، أجر بالساعة، حالة
-- التفعيل)، بالإضافة لتصحيح ثغرة صلاحيات حقيقية بالسياسة القديمة —
-- profiles_update_own كانت تسمح لأي موظف (حتى staff عادي) يعدّل صف
-- بروفايله الخاص بالكامل عبر نداء تحديث عادي، بما فيه عمود role نفسه!
-- يعني أي كاشير كان يقدر يرفّع نفسه لـ"owner" بنداء واحد لـSupabase.
--
-- الحل: نفس سياسة auth.uid() = id تضل موجودة (بالإضافة لصلاحية owner/
-- manager للتعديل على أي موظف)، لكن trigger جديد قبل أي تحديث يمنع أي
-- حدا غير owner/manager من تغيير role أو hourly_wage أو is_active — حتى
-- بصفه هو، مش بس بصف غيره.
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists hourly_wage numeric(10,2);
alter table public.profiles add column if not exists is_active boolean not null default true;

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update on public.profiles
  for update using (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  )
  with check (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  caller_role text;
begin
  -- auth.uid() بيرجع NULL بس لما ما يكون في JWT مستخدم أصلًا — يعني نداء
  -- من السيرفر مباشرة بمفتاح service_role (مثل Edge Function إضافة
  -- موظف جديد)، أو من SQL Editor بلوحة Supabase. المفتاح هذا سر ما
  -- بيوصل أبدًا لكود المتصفح، فهاد النداء موثوق مسبقًا زي ما هو
  if auth.uid() is null then
    return new;
  end if;
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role in ('owner', 'manager') then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.hourly_wage is distinct from old.hourly_wage
     or new.is_active is distinct from old.is_active then
    raise exception 'غير مسموح تعديل الدور أو الأجر أو حالة التفعيل — راجع مديرك';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileges_trigger on public.profiles;
create trigger protect_profile_privileges_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();
