-- «حاسب الطاولة» وقت انقطاع النت: الحساب اللي انفتح بدون نت ما إله رقم (id) بالسحابة لسا، بس إله client_ref
-- (الكاشير بعتو مع place_table_order المحفوظ بالطابور). هالدالة بتسدّد بالـ client_ref وبتستدعي settle_table_tab
-- نفسها، فكل القواعد (الصلاحيات، حد الخصم وموافقة المدير، مطابقة المبلغ، الطباعة، تحرير الطاولة) بتضل كما هي.
-- بتنفّذ بنفس ترتيب طابور الكاشير، فأول ما توصل place_table_order بيكون الحساب موجود.
-- لو الحساب انسدّد أصلًا (إعادة إرسال بعد انقطاع الرد) بترجّع رقمه بدون ما تسدّده مرتين.
-- آمن لإعادة التشغيل. لا بيعدّل أي دالة موجودة.

create or replace function public.settle_table_tab_by_ref(
  p_sale_ids uuid[],
  p_client_refs uuid[],
  p_cash numeric,
  p_card numeric,
  p_discount numeric default 0,
  p_entry_date date default current_date,
  p_cash_received numeric default null
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_ids uuid[];
  v_open int;
begin
  if public.auth_role() is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if coalesce(array_length(p_sale_ids, 1), 0) + coalesce(array_length(p_client_refs, 1), 0) = 0 then
    raise exception 'ما في حساب للتسديد';
  end if;

  select array_agg(distinct x.id) into v_ids from (
    select u as id from unnest(coalesce(p_sale_ids, '{}'::uuid[])) u
    union
    select s.id from public.sales_entries s where s.client_ref = any(coalesce(p_client_refs, '{}'::uuid[]))
    union
    select a.sale_id from public.sale_additions a where a.client_ref = any(coalesce(p_client_refs, '{}'::uuid[]))
  ) x;

  if v_ids is null then
    raise exception 'الطلب لسا ما وصل للسحابة';
  end if;

  select count(*) into v_open from public.sales_entries
   where id = any(v_ids) and tab_open and status = 'completed';
  -- كلها منسدّدة من قبل: إعادة إرسال، منرجّع بدون تكرار
  if v_open = 0 and exists (select 1 from public.sales_entries where id = any(v_ids) and not tab_open and status = 'completed') then
    return v_ids[1];
  end if;

  return public.settle_table_tab(v_ids, p_cash, p_card, p_discount, p_entry_date, p_cash_received);
end;
$$;

revoke execute on function public.settle_table_tab_by_ref(uuid[], uuid[], numeric, numeric, numeric, date, numeric) from public, anon;
grant execute on function public.settle_table_tab_by_ref(uuid[], uuid[], numeric, numeric, numeric, date, numeric) to authenticated;
