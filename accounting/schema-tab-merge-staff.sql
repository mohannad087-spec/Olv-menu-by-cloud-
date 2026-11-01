-- إصلاح: الكاشير ما كان يقدر يسكّر طاولة عليها أكتر من حساب مفتوح (مثلًا بعد النقل/الدمج أو طلبات وايتر مختلفة)،
-- لأن merge_sales بتسمح للكاشير يدمج طلباته هو بس وخلال مدة محدودة. الحسابات المفتوحة ما فيها مصاري (ما انسدّدت)،
-- فبنتجاوز هالقيد لما الهدف وكل المصادر حسابات طاولة مفتوحة. باقي القيود على الطلبات المسدّدة ما بتتغيّر.
-- آمن لإعادة التشغيل: لو الدالة انعدلت قبل ما بيعمل شي.
do $$
declare
  v_def text := pg_get_functiondef('public.merge_sales(uuid, uuid[])'::regprocedure);
  v_new text := v_def;
begin
  if v_def like '%v_t.tab_open%' then
    raise notice 'merge_sales معدّلة من قبل';
    return;
  end if;
  -- المسافات بالدالة الحيّة مش ثابتة، فنستعمل regexp
  v_new := regexp_replace(v_new,
    'if v_role = ''staff'' then(\s+)v_hours :=',
    'if v_role = ''staff'' and not (coalesce(v_t.tab_open, false) and coalesce(v_s.tab_open, false)) then\1v_hours :=');
  v_new := replace(v_new,
    'if v_role = ''staff'' and v_t.created_by is distinct from auth.uid() then',
    'if v_role = ''staff'' and not coalesce(v_t.tab_open, false) and v_t.created_by is distinct from auth.uid() then');
  if v_new = v_def or (length(v_new) - length(replace(v_new, 'v_t.tab_open', ''))) / length('v_t.tab_open') <> 2 then
    raise exception 'ما لقيت النص المطلوب تعديله بدالة merge_sales';
  end if;
  execute v_new;
end $$;
