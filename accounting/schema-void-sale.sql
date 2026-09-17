-- إلغاء/إرجاع عملية بيع بشكل صحيح: بدل حذف القيد نهائيًا (يفقد الأثر
-- ولا يرجّع المخزون)، دالة void_sale ترجّع كل المواد الخام المستهلكة
-- بوصفة كل صنف، وتلغي أي طلب طباعة لسا ما انطبع، وتعلّم العملية
-- "ملغاة" بدل حذفها فعليًا حتى يضل لها أثر بالسجل والتقارير

alter table public.sales_entries add column if not exists status text not null default 'completed' check (status in ('completed', 'voided'));
alter table public.sales_entries add column if not exists void_reason text;
alter table public.sales_entries add column if not exists voided_at timestamptz;
alter table public.sales_entries add column if not exists voided_by uuid references public.profiles(id);

create index if not exists sales_entries_status_idx on public.sales_entries (status);

create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_item record;
begin
  select status into v_status from public.sales_entries where id = p_sale_id;
  if v_status is null then
    raise exception 'عملية البيع غير موجودة';
  end if;
  if v_status = 'voided' then
    raise exception 'هذه العملية ملغاة أصلًا';
  end if;

  -- يرجّع كل مادة خام استهلكتها وصفة كل صنف بالطلب (لا يشمل استهلاك
  -- الإضافات، لنفس السبب الموثّق بتقدير "يكفي لـ" في صفحة المخزون:
  -- لا يوجد ربط محفوظ بين سطر البيع والإضافات المختارة فيه)
  for v_item in select product_id, qty from public.sale_items where sale_id = p_sale_id
  loop
    update public.ingredients i
    set current_stock = i.current_stock + (pi.quantity * v_item.qty)
    from public.product_ingredients pi
    where pi.product_id = v_item.product_id and pi.ingredient_id = i.id;
  end loop;

  update public.print_jobs set status = 'skipped'
  where sale_id = p_sale_id and status = 'pending';

  update public.sales_entries
  set status = 'voided', void_reason = p_reason, voided_at = now(), voided_by = auth.uid()
  where id = p_sale_id;
end;
$$;

grant execute on function public.void_sale(uuid, text) to authenticated;

-- يستثني الطلبات الملغاة من ترتيب "الأكثر مبيعًا" بشاشة بيع سريع
create or replace view public.product_sales_totals as
select si.product_id, sum(si.qty) as total_qty
from public.sale_items si
join public.sales_entries se on se.id = si.sale_id
where si.product_id is not null and se.status = 'completed'
group by si.product_id;
