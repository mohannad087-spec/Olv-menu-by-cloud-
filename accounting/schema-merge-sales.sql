-- دمج عدة طلبات مبيعات بفاتورة واحدة (مثلًا طلبين لنفس الطاولة).
-- merge_sales بتنقل أصناف الطلبات المصدر على الطلب الهدف وبتجمع الدفعات والخصم، وبتحذف الطلبات الفاضية.
-- المخزون ما بيتغيّر (الأصناف نفسها بس بتغيّر مكانها)، والمطبخ ما بيطبع شي جديد، وتذاكر المطبخ القديمة بتضل مربوطة بالطلب الهدف.
-- سجل الدمج بجدول sale_merges (ما بيتعدّل). آمن لإعادة التشغيل.

create table if not exists public.sale_merges (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  target_id uuid not null references public.sales_entries(id) on delete cascade,
  actor uuid,
  actor_name text,
  source_ids uuid[] not null,
  source_labels text[] not null,
  moved_total numeric not null
);
alter table public.sale_merges enable row level security;
drop policy if exists sale_merges_select on public.sale_merges;
create policy sale_merges_select on public.sale_merges for select using (public.auth_role() is not null);
revoke insert, update, delete on public.sale_merges from anon, authenticated;

create or replace function public.merge_sales(p_target uuid, p_sources uuid[])
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_hours numeric;
  v_t record;
  v_s record;
  v_n int := 0;
  v_ids uuid[] := '{}';
  v_labels text[] := '{}';
  v_moved numeric := 0;
  v_cash numeric; v_card numeric; v_del numeric; v_disc numeric; v_recv numeric; v_chg numeric;
  v_notes text;
  v_ready boolean;
  v_sum numeric;
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if p_sources is null or coalesce(array_length(p_sources, 1), 0) = 0 then
    raise exception 'اختر طلب واحد على الأقل للدمج';
  end if;
  if p_target = any(p_sources) then
    raise exception 'ما بينفع تدمج الطلب مع نفسه';
  end if;

  -- قفل ثابت الترتيب (الهدف ثم المصادر) لمنع التعارض لو تنفّذ دمجين بنفس الوقت
  select * into v_t from public.sales_entries where id = p_target for update;
  if v_t.id is null then raise exception 'الطلب الهدف غير موجود'; end if;
  perform 1 from public.sales_entries where id = any(p_sources) order by id for update;

  v_cash := coalesce(v_t.cash_amount, 0); v_card := coalesce(v_t.card_amount, 0);
  v_del := coalesce(v_t.delivery_amount, 0); v_disc := coalesce(v_t.discount_amount, 0);
  v_recv := v_t.cash_received; v_chg := v_t.change_due; v_notes := v_t.notes;
  v_ready := coalesce(v_t.kitchen_status, '') = 'جاهز';

  for v_s in select * from public.sales_entries where id = any(p_sources) order by created_at
  loop
    if v_s.status = 'voided' then
      raise exception 'في طلب ملغى بين المختارين — ما بينفع دمجه';
    end if;
    v_n := v_n + 1;
    v_ids := v_ids || v_s.id;
    v_labels := v_labels || (coalesce(v_s.doc_no::text, '') || '/' || coalesce(v_s.order_no::text, ''));
    v_cash := v_cash + coalesce(v_s.cash_amount, 0);
    v_card := v_card + coalesce(v_s.card_amount, 0);
    v_del := v_del + coalesce(v_s.delivery_amount, 0);
    v_disc := v_disc + coalesce(v_s.discount_amount, 0);
    if v_s.cash_received is not null then v_recv := coalesce(v_recv, 0) + v_s.cash_received; end if;
    if v_s.change_due is not null then v_chg := coalesce(v_chg, 0) + v_s.change_due; end if;
    if nullif(btrim(coalesce(v_s.notes, '')), '') is not null and v_s.notes is distinct from v_notes then
      v_notes := concat_ws(' | ', nullif(v_notes, ''), v_s.notes);
    end if;
    v_ready := v_ready and coalesce(v_s.kitchen_status, '') = 'جاهز';
    if v_role = 'staff' then
      v_hours := public.app_setting_num('staff_reprint_hours', 24);
      if v_s.created_by is distinct from auth.uid() then
        raise exception 'الكاشير بيدمج طلباته هو بس — بلّغ المدير';
      end if;
      if now() - v_s.created_at > v_hours * interval '1 hour' then
        raise exception 'مرّت أكتر من % ساعة على أحد الطلبات — بلّغ المدير', v_hours;
      end if;
    end if;
    select coalesce(sum((unit_price + coalesce(addons_total, 0)) * qty), 0) into v_sum
    from public.sale_items where sale_id = v_s.id and coalesce(status, '') <> 'voided';
    v_moved := v_moved + v_sum;
  end loop;

  if v_n <> array_length(p_sources, 1) then
    raise exception 'في طلب غير موجود بين المختارين';
  end if;
  if v_role = 'staff' and v_t.created_by is distinct from auth.uid() then
    raise exception 'الكاشير بيدمج طلباته هو بس — بلّغ المدير';
  end if;
  if v_t.status = 'voided' then raise exception 'الطلب الهدف ملغى'; end if;

  -- نقل الأصناف والسجلات (الأصناف بتحتفظ بمعرّفها فتذاكر المطبخ القديمة بتضل صالحة)
  update public.sale_items set sale_id = p_target where sale_id = any(p_sources);
  update public.print_jobs set sale_id = p_target where sale_id = any(p_sources);
  update public.receipt_reprints set sale_id = p_target where sale_id = any(p_sources);
  update public.sale_edit_log set sale_id = p_target where sale_id = any(p_sources);
  update public.sale_additions set sale_id = p_target where sale_id = any(p_sources);

  update public.sales_entries
     set cash_amount = v_cash, card_amount = v_card, delivery_amount = v_del,
         discount_amount = v_disc, cash_received = v_recv, change_due = v_chg, notes = v_notes,
         customer_phone = coalesce(customer_phone, (select customer_phone from public.sales_entries where id = any(p_sources) and customer_phone is not null limit 1)),
         customer_name = coalesce(customer_name, (select customer_name from public.sales_entries where id = any(p_sources) and customer_name is not null limit 1)),
         table_number = coalesce(table_number, (select table_number from public.sales_entries where id = any(p_sources) and table_number is not null limit 1)),
         kitchen_status = case when v_ready then 'جاهز' else 'قيد التحضير' end,
         kitchen_ready_at = case when v_ready then kitchen_ready_at else null end
   where id = p_target;

  -- السجل أولًا (مرتبط بالهدف) ثم حذف الطلبات الفاضية
  insert into public.sale_merges (target_id, actor, actor_name, source_ids, source_labels, moved_total)
  values (p_target, auth.uid(), (select full_name from public.profiles where id = auth.uid()), v_ids, v_labels, v_moved);

  delete from public.sales_entries where id = any(p_sources);
  return v_n;
end;
$$;

revoke all on function public.merge_sales(uuid, uuid[]) from public, anon;
grant execute on function public.merge_sales(uuid, uuid[]) to authenticated;
