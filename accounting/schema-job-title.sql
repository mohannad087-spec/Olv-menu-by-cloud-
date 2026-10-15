-- المسمّى الوظيفي للموظف (كاشير، ويتر، شيف، معلم أرجيلة...): نص حر للعرض فقط،
-- الصلاحيات تظل حسب الدور (role). آمن للتشغيل أكثر من مرة.
alter table public.profiles add column if not exists job_title text;

-- إصلاح خطأ «infinite recursion detected in policy for relation profiles» عند حفظ تعديل موظف:
-- سياسة profiles_update كانت تقرأ جدول profiles نفسه، فصارت تستعمل is_admin() (security definer).
alter policy profiles_update on public.profiles
  using (((select auth.uid()) = id) or public.is_admin())
  with check (((select auth.uid()) = id) or public.is_admin());
