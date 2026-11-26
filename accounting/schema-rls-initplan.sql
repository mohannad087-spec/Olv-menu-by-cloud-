-- تسريع: كل سياسات RLS اللي بتنادي auth_role()/is_admin()/is_owner() مباشرة كانت
-- بتتنفّذ مرة لكل صف (٨٠٠٠ صف مبيعات = ٣٠٠ مللي ثانية). تغليفها بـ (select ...)
-- بيخلّي Postgres يحسبها مرة وحدة بالاستعلام. نفس الصلاحيات بالضبط، بس أسرع.
do $$
declare
  r record;
  nq text; nw text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') ~ '(auth_role|is_admin|is_owner)\(\)'
        or coalesce(with_check,'') ~ '(auth_role|is_admin|is_owner)\(\)')
      and coalesce(qual,'') !~* 'select (public\.)?(auth_role|is_admin|is_owner)'
      and coalesce(with_check,'') !~* 'select (public\.)?(auth_role|is_admin|is_owner)'
  loop
    nq := case when r.qual is null then null
      else regexp_replace(r.qual, '(public\.)?(auth_role|is_admin|is_owner)\(\)', '(select \1\2())', 'g') end;
    nw := case when r.with_check is null then null
      else regexp_replace(r.with_check, '(public\.)?(auth_role|is_admin|is_owner)\(\)', '(select \1\2())', 'g') end;
    execute format('alter policy %I on %I.%I %s %s',
      r.policyname, r.schemaname, r.tablename,
      case when nq is not null then 'using (' || nq || ')' else '' end,
      case when nw is not null then 'with check (' || nw || ')' else '' end);
  end loop;
end $$;
