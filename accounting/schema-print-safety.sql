-- ضمانات سلامة تحضير الطلبات:
--   ١) رقم طلب يومي متسلسل (يظهر كبير على الفاتورة وكل تذاكر الأقسام) عشان
--      تتطابق تذاكر المطبخ والبار والأراجيل لنفس الطلب بدون لخبطة
--   ٢) تذكرة "إلغاء" تنطبع تلقائيًا للأقسام اللي وصلها الطلب لو انلغى (كامل
--      أو صنف واحد) بعد ما انطبع، حتى ما يكمل المطبخ تحضير طلب ملغي
--   ٣) طباعة تجريبية لكل طابعة (مهمة بدون عملية بيع)

-- ---------- ١) رقم الطلب اليومي ----------
alter table public.sales_entries add column if not exists order_no int;

create table if not exists public.daily_order_counters (
  entry_date date primary key,
  last_no int not null default 0
);
alter table public.daily_order_counters enable row level security;
drop policy if exists daily_order_counters_rw on public.daily_order_counters;
create policy daily_order_counters_rw on public.daily_order_counters
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- upsert بقفل الصف يضمن ما يتكرر رقم حتى لو كاشيرين باعوا بنفس اللحظة
create or replace function public.assign_order_no()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.order_no is null then
    insert into public.daily_order_counters as c (entry_date, last_no)
    values (new.entry_date, 1)
    on conflict (entry_date) do update set last_no = c.last_no + 1
    returning c.last_no into new.order_no;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_entries_assign_order_no on public.sales_entries;
create trigger sales_entries_assign_order_no
  before insert on public.sales_entries
  for each row execute function public.assign_order_no();

-- ---------- ٣ + ٢) أنواع مهام جديدة: cancel (إلغاء) و test (تجريبية) ----------
alter table public.print_jobs alter column sale_id drop not null;
alter table public.print_jobs drop constraint if exists print_jobs_job_type_check;
alter table public.print_jobs
  add constraint print_jobs_job_type_check check (job_type in ('kitchen', 'receipt', 'cancel', 'test'));

-- ---------- ٢) تذكرة إلغاء عند إلغاء صنف واحد ----------
create or replace function public.cancel_item_print()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job record;
begin
  if new.status = 'voided' and old.status is distinct from 'voided' then
    for v_job in
      select * from public.print_jobs
      where sale_id = new.sale_id and job_type = 'kitchen' and status = 'printed'
        and printer_id is not null and new.id = any(item_ids)
    loop
      insert into public.print_jobs (sale_id, job_type, printer_id, item_ids)
      values (new.sale_id, 'cancel', v_job.printer_id, array[new.id]);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists sale_items_cancel_print on public.sale_items;
create trigger sale_items_cancel_print
  after update of status on public.sale_items
  for each row execute function public.cancel_item_print();

-- ---------- ٢) تذكرة إلغاء عند إلغاء الطلب كامل ----------
-- بس الأصناف اللي لسا "completed" وقت الإلغاء (اللي انلغت فرادى قبل، أخدت
-- تذكرتها أصلًا، فما بتتكرر). void_sale ما بتعلّم الأصناف ملغاة، فكلها
-- بتنحسب هون
create or replace function public.cancel_sale_print()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job record;
  v_ids uuid[];
begin
  if new.status = 'voided' and old.status is distinct from 'voided' then
    for v_job in
      select * from public.print_jobs
      where sale_id = new.id and job_type = 'kitchen' and status = 'printed' and printer_id is not null
    loop
      select array_agg(si.id) into v_ids
      from public.sale_items si
      where si.sale_id = new.id and si.status = 'completed' and si.id = any(v_job.item_ids);
      if v_ids is not null then
        insert into public.print_jobs (sale_id, job_type, printer_id, item_ids)
        values (new.id, 'cancel', v_job.printer_id, v_ids);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_entries_cancel_print on public.sales_entries;
create trigger sales_entries_cancel_print
  after update of status on public.sales_entries
  for each row execute function public.cancel_sale_print();
