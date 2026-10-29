-- حساب الطاولة المفتوح: الكاشير بيشطب صنف أو بيلغي الحساب طول ما هو مفتوح (لسا ما انسدّد).
-- قبل هيك مهلة الإلغاء للكاشير (staff_void_minutes، 10 دقايق) كانت تنحسب من لحظة فتح الحساب، فبعد 10 دقايق
-- الزبون يلغي صنف والكاشير ما بيقدر يشطبه. هلق المهلة بتبدأ بعد التسديد (مثل أي طلب مدفوع).
-- باقي الشروط ما بتتغير: سبب الإلغاء إلزامي، والكاشير بيلغي طلباته هو بس، والإلغاء بيتسجّل بسجل التدقيق.
-- بنعدّل شرط المهلة بالدالتين الموجودتين (void_sale و void_sale_item) بدون ما نعيد كتابتهم. آمن لإعادة التشغيل.

do $$
declare
  v_fn text;
  v_def text;
  v_new text;
begin
  foreach v_fn in array array['public.void_sale(uuid, text)', 'public.void_sale_item(uuid, text)']
  loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if v_def like '%tab_open%' then
      continue; -- معدّلة أصلًا
    end if;
    v_new := replace(
      v_def,
      'if now() - v_sale.created_at > v_minutes * interval ''1 minute'' then',
      'if not coalesce(v_sale.tab_open, false) and now() - v_sale.created_at > v_minutes * interval ''1 minute'' then'
    );
    if v_new = v_def then
      raise exception 'ما لقيت شرط المهلة بـ %', v_fn;
    end if;
    execute v_new;
  end loop;
end $$;
