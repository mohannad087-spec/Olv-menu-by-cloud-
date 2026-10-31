-- الكاشير على حساب طاولة مفتوح (tab_open): يضيف أصناف ويشطب صنف حتى لو الطلب فتحه ويتر أو كاشير ثاني،
-- وبدون حد الساعات. القيود على باقي الطلبات (المدفوعة) ما بتتغير.
-- وبنضيف staff_print_bill: الكاشير يطبع مسودة أو نسخة زبون على أي طابعة يختارها.
-- بنعدّل شرط «طلباته هو بس» بالدوال الثلاث الموجودة بدون ما نعيد كتابتها. آمن لإعادة التشغيل.

do $$
declare
  v_fn text;
  v_def text;
  v_new text;
begin
  foreach v_fn in array array['public.add_items_to_sale(uuid, jsonb, numeric, numeric, numeric, uuid)', 'public.void_sale_item(uuid, text)', 'public.void_sale(uuid, text)']
  loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if v_def like '%created_by is distinct from auth.uid() and not coalesce(v_sale.tab_open%' then
      continue; -- معدّلة أصلًا
    end if;
    v_new := replace(v_def,
      'if v_sale.created_by is distinct from auth.uid() then',
      'if v_sale.created_by is distinct from auth.uid() and not coalesce(v_sale.tab_open, false) then');
    v_new := replace(v_new,
      'if now() - v_sale.created_at > v_hours * interval ''1 hour'' then',
      'if not coalesce(v_sale.tab_open, false) and now() - v_sale.created_at > v_hours * interval ''1 hour'' then');
    if v_new = v_def then
      raise exception 'ما لقيت الشرط بـ %', v_fn;
    end if;
    execute v_new;
  end loop;
end $$;

create or replace function public.staff_print_bill(p_sale_id uuid, p_kind text, p_printer_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  if public.auth_role() is null then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  if p_kind not in ('draft', 'customer') then raise exception 'نوع الطباعة غير صالح'; end if;
  if not exists (select 1 from public.sales_entries where id = p_sale_id and tab_open and status = 'completed') then
    raise exception 'الحساب انسدّد أو انلغى، حدّث الصفحة';
  end if;
  if not exists (select 1 from public.printers where id = p_printer_id and enabled) then
    raise exception 'الطابعة غير موجودة أو متوقفة';
  end if;
  if exists (select 1 from public.print_jobs where sale_id = p_sale_id and bill_kind is not null and created_at > now() - interval '5 seconds') then
    raise exception 'انطلبت طباعة قبل ثواني، استنى شوي';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.print_jobs (sale_id, job_type, printer_id, bill_kind, reprint_by)
  values (p_sale_id, 'receipt', p_printer_id, p_kind, coalesce(v_name, '—'));
end;
$$;

revoke execute on function public.staff_print_bill(uuid, text, uuid) from public, anon;
grant execute on function public.staff_print_bill(uuid, text, uuid) to authenticated;
