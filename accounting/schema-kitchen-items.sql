-- شاشة المطبخ: تحديث فوري + شطب كل صنف لحاله + فصل المطبخ عن البار.
-- يُطبّق مرة وحدة بـ SQL Editor (آمن للتكرار).

-- 1) البث الفوري (Realtime): الشاشة بتعرف بالطلب الجديد بلحظتها بدل ما تستنى التحديث كل 15 ثانية.
-- الصلاحيات نفسها (RLS) بتنطبق عالبث، يعني ما حدا بيشوف إشي ما كان بيقدر يقرأه أصلًا.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales_entries') then
    alter publication supabase_realtime add table public.sales_entries;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sale_items') then
    alter publication supabase_realtime add table public.sale_items;
  end if;
end $$;

-- 2) كل صنف إلو وقت «خلص» لحاله
alter table public.sale_items add column if not exists kitchen_done_at timestamptz;

-- علّم أصناف من طلب «خلصت» (أو رجّعها). لما كل الأصناف (غير الملغاة) تخلص، الطلب كلّه بيصير «جاهز» لحاله،
-- ولو صنف رجع، الطلب بيرجع «قيد التحضير».
create or replace function public.set_items_kitchen_done(p_sale_id uuid, p_item_ids uuid[], p_done boolean)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_left int;
  v_new text;
begin
  if public.auth_role() is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  select status into v_status from public.sales_entries where id = p_sale_id for update;
  if v_status is null then
    raise exception 'الطلب غير موجود';
  end if;
  if v_status = 'voided' then
    raise exception 'هذا الطلب ملغى';
  end if;

  update public.sale_items
     set kitchen_done_at = case when p_done then coalesce(kitchen_done_at, now()) else null end
   where sale_id = p_sale_id and id = any(p_item_ids) and status is distinct from 'voided';

  select count(*) into v_left from public.sale_items
   where sale_id = p_sale_id and status is distinct from 'voided' and kitchen_done_at is null;
  v_new := case when v_left = 0 then 'جاهز' else 'قيد التحضير' end;

  update public.sales_entries
     set kitchen_status = v_new,
         kitchen_ready_at = case when v_new = 'جاهز' then coalesce(kitchen_ready_at, now()) else null end
   where id = p_sale_id and kitchen_status is distinct from v_new;
  return v_new;
end;
$$;

revoke execute on function public.set_items_kitchen_done(uuid, uuid[], boolean) from public, anon;
grant execute on function public.set_items_kitchen_done(uuid, uuid[], boolean) to authenticated;

-- ملاحظة: شاشة المطبخ صارت تستعمل set_items_kitchen_done حتى لزر «إرجاع لقيد التحضير» وتعليم الطلبات القديمة،
-- فـset_kitchen_status (schema-kitchen-ready.sql) ما عاد حدا يستعملها من الشاشة.

-- سجل التعديلات: شطب الأصناف ووقت الجاهزية ضجيج، ما بينسجّلوا
create or replace trigger sale_items_audit after update or delete on public.sale_items
  for each row execute function public.log_audit('kitchen_done_at');
create or replace trigger sales_entries_audit after update or delete on public.sales_entries
  for each row execute function public.log_audit('kitchen_status,kitchen_ready_at');

-- 3) أقسام البار: أسماء الأقسام (products.category) اللي أصنافها بتروح لشاشة البار، والباقي للمطبخ.
-- المالك/المدير بيعدّلها من شاشة المطبخ نفسها (زر «الأقسام»).
insert into public.app_settings (key, value) values ('kitchen_bar_categories',
  '["عصائر","عصائر وموكتيلات","كوكتيل","مشروبات باردة","مشروبات ساخنة","ميلك شيك","بوظة","أرجيلة"]')
on conflict (key) do nothing;

-- 4) (بدل kitchen_bar_categories) محطات متعددة: كل محطة إلها أقسامها. أول محطة بتاخد أي قسم مش محطوط.
insert into public.app_settings (key, value) values ('kitchen_stations',
  '[{"id":"kitchen","name":"المطبخ","icon":"flame","categories":["برغر","باستا","ساندويشات","سلطات","سناكات"]},{"id":"hall","name":"بار الصالة","icon":"coffee","categories":["مشروبات ساخنة","مشروبات باردة","كوكتيل","عصائر وموكتيلات"]},{"id":"reception","name":"بار الاستقبال","icon":"cup","categories":["عصائر","ميلك شيك","بوظة","حلويات","دونات"]},{"id":"shisha","name":"الأرجيلة","icon":"shisha","categories":["أرجيلة"]}]')
on conflict (key) do nothing;
