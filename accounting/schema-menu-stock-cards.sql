-- بطاقة المادة + التسعير الذكي للمنيو من المخزون
--
--   • بطاقة المادة: مواد متشابهة (علب غازية 330 مل: كولا، سبرايت، فانتا زيرو...) بتظهر بالمنيو العام كبطاقة وحدة
--     فيها "اختر النوع" بدل بطاقة لكل صنف. كل نوع ضل مادة مستقلة بمخزونه وسعره، وبيختفي من البطاقة لما يخلص،
--     والبطاقة كلها بتختفي لو خلصت كل أنواعها (menu_group = اسم البطاقة، menu_variant = اسم الخيار)
--   • التسعير الذكي: سعر البيع = تكلفة المادة (آخر سعر شراء) × (1 + نسبة الربح)، مقرّب لأعلى لأقرب 0.05.
--     مواد البطاقة الوحدة بتاخد نفس السعر (الأعلى) فبتظهر البطاقة بسعر موحّد. لما تسجّل فاتورة شراء بسعر جديد
--     السعر بيتحدث لحاله بالمنيو وبنقطة البيع طالما "تسعير ذكي" مفعّل للمادة
-- شغّله بعد schema-menu-stock.sql

alter table public.ingredients add column if not exists menu_group text;
alter table public.ingredients add column if not exists menu_variant text;
alter table public.ingredients add column if not exists menu_price_auto boolean not null default false;

insert into public.app_settings (key, value) values ('menu_markup_pct', '50')
on conflict (key) do nothing;

create or replace function public._smart_price(p_cost numeric, p_markup numeric)
returns numeric
language sql
immutable
as $$
  select case when p_cost is null or p_cost <= 0 then null
              else ceil((p_cost * (1 + coalesce(p_markup, 50) / 100.0)) / 0.05) * 0.05 end
$$;

-- يعيد تسعير كل المواد المعروضة بتسعير ذكي (سعر موحّد للبطاقة الوحدة = الأعلى بين أنواعها) ويزامن سعر منتج نقطة البيع
create or replace function public._reprice_menu_stock()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_markup numeric := public.app_setting_num('menu_markup_pct', 50);
  v_n int;
begin
  with s as (
    select id, menu_group, public._smart_price(unit_price, v_markup) as sug
      from public.ingredients
     where menu_enabled and menu_price_auto
       and menu_cat is distinct from 'shisha-flavor'
       and coalesce(unit_price, 0) > 0
  ), g as (
    select id,
           case when coalesce(menu_group, '') = '' then sug
                else max(sug) over (partition by menu_group) end as price
      from s
  )
  update public.ingredients i
     set menu_price = g.price
    from g
   where i.id = g.id and i.menu_price is distinct from g.price;
  get diagnostics v_n = row_count;

  update public.products p
     set price = i.menu_price
    from public.ingredients i
   where p.external_id = i.menu_item_id
     and i.menu_enabled and i.menu_price is not null
     and i.menu_cat is distinct from 'shisha-flavor'
     and p.price is distinct from i.menu_price;
  return v_n;
end;
$$;
revoke execute on function public._reprice_menu_stock() from public, anon, authenticated;

create or replace function public._tg_reprice_menu_stock()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform public._reprice_menu_stock();
  return null;
end;
$$;

create or replace trigger ingredients_reprice
  after update of unit_price, menu_price_auto, menu_enabled, menu_group on public.ingredients
  for each statement execute function public._tg_reprice_menu_stock();

-- نسخة موسّعة من set_menu_stock_item (schema-menu-stock.sql) بإضافة البطاقة (group/variant) والتسعير الذكي (p_auto)؛
-- الشاشة صارت تستعمل هالدالة، والقديمة بتضل موجودة بدون استعمال
create or replace function public.save_menu_stock_item(
  p_ingredient_id uuid,
  p_enabled boolean,
  p_price numeric,
  p_cat text,
  p_cat_ar text,
  p_name_en text,
  p_group text default null,
  p_variant text default null,
  p_auto boolean default false
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_ing record;
  v_product uuid;
  v_cat_ar text := coalesce(nullif(trim(p_cat_ar), ''), 'عام');
  v_flavor boolean := p_enabled and trim(coalesce(p_cat, '')) = 'shisha-flavor';
  v_auto boolean := p_enabled and not v_flavor and coalesce(p_auto, false);
  v_markup numeric := public.app_setting_num('menu_markup_pct', 50);
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للمالك والمدير فقط';
  end if;
  select * into v_ing from public.ingredients where id = p_ingredient_id;
  if v_ing.id is null then
    raise exception 'المادة غير موجودة';
  end if;
  if p_enabled and not v_flavor then
    if coalesce(trim(p_cat), '') = '' then
      raise exception 'اختر تصنيف المنيو';
    end if;
    if (p_price is null or p_price <= 0) and not (v_auto and public._smart_price(v_ing.unit_price, v_markup) is not null) then
      raise exception 'حدد سعر البيع (أو سجّل فاتورة شراء للمادة حتى يتحسب السعر الذكي من تكلفتها)';
    end if;
  end if;

  update public.ingredients
     set menu_enabled = p_enabled,
         menu_price = case when v_flavor then 0
                           when p_enabled then coalesce(nullif(p_price, 0), public._smart_price(v_ing.unit_price, v_markup))
                           else menu_price end,
         menu_cat = case when p_enabled then trim(p_cat) else menu_cat end,
         menu_name_en = case when p_enabled then nullif(trim(coalesce(p_name_en, '')), '') else menu_name_en end,
         menu_group = case when p_enabled and not v_flavor then nullif(trim(coalesce(p_group, '')), '') else null end,
         menu_variant = case when p_enabled and not v_flavor then nullif(trim(coalesce(p_variant, '')), '') else null end,
         menu_price_auto = v_auto
   where id = p_ingredient_id;

  -- التسعير الذكي بيوحّد سعر البطاقة (الأعلى)، فنعيد التسعير وبعدين نقرأ الصف
  if v_auto then perform public._reprice_menu_stock(); end if;
  select * into v_ing from public.ingredients where id = p_ingredient_id;

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

revoke execute on function public.save_menu_stock_item(uuid, boolean, numeric, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_menu_stock_item(uuid, boolean, numeric, text, text, text, text, text, boolean) to authenticated;

-- تجميع المواد المتشابهة ببطاقات دفعة وحدة: [{"id":"…","group":"مشروب غازي علبة 330 مل","variant":"سبرايت"}, …]
create or replace function public.set_menu_stock_cards(p_assign jsonb)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_row jsonb;
  v_count int := 0;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للمالك والمدير فقط';
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_assign, '[]'::jsonb)) loop
    update public.ingredients
       set menu_group = nullif(left(trim(coalesce(v_row->>'group', '')), 80), ''),
           menu_variant = nullif(left(trim(coalesce(v_row->>'variant', '')), 80), '')
     where id = (v_row->>'id')::uuid and menu_cat is distinct from 'shisha-flavor';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.set_menu_stock_cards(jsonb) from public, anon;
grant execute on function public.set_menu_stock_cards(jsonb) to authenticated;

-- نسبة الربح للتسعير الذكي (مثلًا 50 = التكلفة + 50%) + إعادة تسعير فوري للمواد اللي تسعيرها ذكي
create or replace function public.set_menu_markup(p_pct numeric)
returns int
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للمالك والمدير فقط';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 1000 then
    raise exception 'نسبة الربح لازم تكون بين 0 و 1000';
  end if;
  insert into public.app_settings (key, value) values ('menu_markup_pct', trim(to_char(p_pct, 'FM999999990.##')))
  on conflict (key) do update set value = excluded.value;
  return public._reprice_menu_stock();
end;
$$;
revoke execute on function public.set_menu_markup(numeric) from public, anon;
grant execute on function public.set_menu_markup(numeric) to authenticated;

-- تفعيل التسعير الذكي دفعة وحدة للمواد المعروضة (اللي إلها تكلفة): p_overwrite=false بيخلي المسعّرة يدويًا على حالها
create or replace function public.smart_price_menu_items(p_ids uuid[], p_overwrite boolean default false)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للمالك والمدير فقط';
  end if;
  update public.ingredients
     set menu_price_auto = true
   where id = any(p_ids)
     and menu_enabled and menu_cat is distinct from 'shisha-flavor'
     and coalesce(unit_price, 0) > 0
     and (coalesce(p_overwrite, false) or menu_price is null or menu_price <= 0);
  get diagnostics v_n = row_count;
  perform public._reprice_menu_stock();
  return v_n;
end;
$$;
revoke execute on function public.smart_price_menu_items(uuid[], boolean) from public, anon;
grant execute on function public.smart_price_menu_items(uuid[], boolean) to authenticated;

notify pgrst, 'reload schema';
