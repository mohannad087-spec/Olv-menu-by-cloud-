-- الموارد البشرية: إرفاق بصمات الدوام (أيام التأخر/الغياب) كدليل مع الإنذار.
-- evidence = مصفوفة JSON: [{d:'2026-11-10', s:'<وقت الدوام المجدول>', p:'<وقت أول بصمة أو null>', m:<دقائق التأخر>, a:true للغياب}]
-- نسخة مثبّتة وقت التسجيل، حتى لو تغيّر الجدول أو البصمات بعدين. الكتابة عبر دالة للمالك والمدير فقط.
alter table public.hr_records add column if not exists evidence jsonb;

create or replace function public.hr_set_evidence(p_id uuid, p_evidence jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'غير مسموح: للمالك والمدير فقط'; end if;
  if p_evidence is not null and jsonb_typeof(p_evidence) <> 'array' then raise exception 'صيغة الأدلة غير صحيحة'; end if;
  update public.hr_records set evidence = p_evidence where id = p_id;
end;
$$;

revoke all on function public.hr_set_evidence(uuid, jsonb) from public, anon;
grant execute on function public.hr_set_evidence(uuid, jsonb) to authenticated;
