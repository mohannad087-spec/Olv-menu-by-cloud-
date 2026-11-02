-- تصحيح طريقة الدفع لبيع انسجل غلط (مثلاً دفع كليك انسجل كاش). للمالك والمدير بس.
-- بيحوّل المبلغ كله لطريقة وحدة، وبيكتب التصحيح بالملاحظات، وسجل التدقيق (audit_log) بيلتقط التغيير لحاله.
create or replace function public.change_sale_payment(p_sale_id uuid, p_method text, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v public.sales_entries%rowtype;
  v_total numeric(12,2);
  v_from text;
  v_to text;
begin
  if not public.is_admin() then
    raise exception 'تصحيح طريقة الدفع للمالك أو المدير فقط';
  end if;
  if p_method not in ('cash', 'card', 'cliq', 'delivery') then
    raise exception 'طريقة دفع غير معروفة';
  end if;
  select * into v from public.sales_entries where id = p_sale_id for update;
  if not found then raise exception 'عملية البيع غير موجودة'; end if;
  if v.status <> 'completed' then raise exception 'ما بينفع تصحيح طلب ملغى'; end if;
  if (case when v.cash_amount > 0 then 1 else 0 end) + (case when v.card_amount > 0 then 1 else 0 end) + (case when v.delivery_amount > 0 then 1 else 0 end) > 1 then
    raise exception 'الطلب مدفوع بأكتر من طريقة، ما بينفع تصحيحه من هون';
  end if;
  v_total := v.cash_amount + v.card_amount + v.delivery_amount;
  v_from := case when v.cash_amount > 0 then 'كاش' when v.card_amount > 0 then 'شبكة/كليك' else 'توصيل' end;
  v_to := case p_method when 'cash' then 'كاش' when 'card' then 'شبكة' when 'cliq' then 'كليك' else 'توصيل' end;
  update public.sales_entries set
    cash_amount = case when p_method = 'cash' then v_total else 0 end,
    card_amount = case when p_method in ('card', 'cliq') then v_total else 0 end,
    delivery_amount = case when p_method = 'delivery' then v_total else 0 end,
    cash_received = case when p_method = 'cash' then cash_received else null end,
    change_due = case when p_method = 'cash' then change_due else null end,
    notes = concat_ws(' — ', nullif(notes, ''), 'تصحيح الدفع: ' || v_from || ' ← ' || v_to || coalesce(' (' || nullif(p_reason, '') || ')', ''))
  where id = p_sale_id;
end;
$$;
grant execute on function public.change_sale_payment(uuid, text, text) to authenticated;
