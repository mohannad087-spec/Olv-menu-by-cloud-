-- المنيو من المخزون: المشروبات والبضاعة الجاهزة (كولا، مي، عصير...) بتظهر بالمنيو العام لحالها طالما
-- موجودة بالمخزون، وبتختفي لما تخلص وبترجع لما تنزل كمية جديدة
--
--   • كل مادة بالمخزون إلها خيار "عرض على المنيو" + سعر البيع + تصنيف المنيو (بتحدده من شاشة "المنيو من المخزون")
--   • بيتنشأ لها منتج بالمحاسبة (نقطة البيع والطلبات الواردة) بوصفة "1 وحدة من المخزون"، فكل بيعة
--     (من المنيو أو الكاشير) بتنقص المخزون، وهذا اللي بيخلي الصنف يختفي من المنيو عند النفاد
--   • المزامنة مع الموقع بتصير من الدالة olv-menu-proxy (action: sync_stock) وبتنادى لحالها
-- شغّله بعد schema-cashier-hardening.sql

alter table public.ingredients add column if not exists menu_enabled boolean not null default false;
alter table public.ingredients add column if not exists menu_price numeric(10,2) check (menu_price is null or menu_price >= 0);
alter table public.ingredients add column if not exists menu_cat text;
alter table public.ingredients add column if not exists menu_name_en text;
alter table public.ingredients add column if not exists menu_hidden boolean not null default false;
alter table public.ingredients add column if not exists menu_item_id text
  generated always as ('stk-' || substr(replace(id::text, '-', ''), 1, 12)) stored;

create or replace function public.set_menu_stock_item(
  p_ingredient_id uuid,
  p_enabled boolean,
  p_price numeric,
  p_cat text,
  p_cat_ar text,
  p_name_en text
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_ing record;
  v_product uuid;
  v_cat_ar text := coalesce(nullif(trim(p_cat_ar), ''), 'عام');
  -- نكهة أرجيلة (معسل): بتظهر كخيار نكهة جوا الأرجيلة بالمنيو، مش كصنف بسعر إلها — فما بنحتاج سعر ولا منتج
  v_flavor boolean := p_enabled and trim(coalesce(p_cat, '')) = 'shisha-flavor';
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للمالك والمدير فقط';
  end if;
  select * into v_ing from public.ingredients where id = p_ingredient_id;
  if v_ing.id is null then
    raise exception 'المادة غير موجودة';
  end if;
  if p_enabled and not v_flavor then
    if p_price is null or p_price <= 0 then
      raise exception 'حدد سعر البيع للمنيو';
    end if;
    if coalesce(trim(p_cat), '') = '' then
      raise exception 'اختر تصنيف المنيو';
    end if;
  end if;

  update public.ingredients
     set menu_enabled = p_enabled,
         menu_price = case when v_flavor then 0 when p_enabled then round(p_price, 2) else menu_price end,
         menu_cat = case when p_enabled then trim(p_cat) else menu_cat end,
         menu_name_en = case when p_enabled then nullif(trim(coalesce(p_name_en, '')), '') else menu_name_en end
   where id = p_ingredient_id
  returning * into v_ing;

  select id into v_product from public.products where external_id = v_ing.menu_item_id;
  if v_flavor then
    if v_product is not null then update public.products set is_active = false where id = v_product; end if;
    return null;
  end if;
  if v_product is null then
    if not p_enabled then return null; end if;
    insert into public.products (name, price, category, external_id, is_active)
    values (v_ing.name, v_ing.menu_price, v_cat_ar, v_ing.menu_item_id, true)
    returning id into v_product;
  else
    update public.products
       set name = v_ing.name,
           price = case when p_enabled then v_ing.menu_price else price end,
           category = case when p_enabled then v_cat_ar else category end,
           is_active = p_enabled
     where id = v_product;
  end if;

  if p_enabled then
    insert into public.product_ingredients (product_id, ingredient_id, quantity)
    values (v_product, p_ingredient_id, 1)
    on conflict (product_id, ingredient_id) do nothing;
  end if;
  return v_product;
end;
$$;

revoke execute on function public.set_menu_stock_item(uuid, boolean, numeric, text, text, text) from public, anon;
grant execute on function public.set_menu_stock_item(uuid, boolean, numeric, text, text, text) to authenticated;

-- تفعيل/إلغاء نكهات المعسل دفعة وحدة (لتفادي استدعاء الدالة فوق لكل نكهة لحالها)
create or replace function public.set_menu_shisha_flavors(p_ids uuid[], p_enabled boolean)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للمالك والمدير فقط';
  end if;
  update public.ingredients
     set menu_enabled = p_enabled,
         menu_cat = case when p_enabled then 'shisha-flavor' else menu_cat end,
         menu_price = case when p_enabled then 0 else menu_price end
   where id = any(p_ids)
     and (not p_enabled or menu_cat is null or menu_cat = 'shisha-flavor' or not menu_enabled);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.set_menu_shisha_flavors(uuid[], boolean) from public, anon;
grant execute on function public.set_menu_shisha_flavors(uuid[], boolean) to authenticated;

notify pgrst, 'reload schema';
