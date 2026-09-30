-- توزيع الطباعة على عدّة طابعات حسب تصنيف الصنف: طابعة كاشير بتطبع الفاتورة
-- كاملة بكل الأصناف، وكل "محطة تحضير" (مطبخ، بار، أراجيل...) بتستقبل
-- أصنافها بس. مثال: طلب فيه وجبة + كوكتيل + أرجيلة ← فاتورة كاملة للكاشير،
-- الوجبة للمطبخ، الكوكتيل للبار، الأرجيلة لمحطة الأراجيل.
--
-- التوزيع بيصير بلحظة تسجيل البيع (trigger على print_jobs) وبيخزّن أرقام
-- الأصناف بكل مهمة (item_ids) — فلو تغيّر تصنيف صنف بعدين، ما بيتغيّر
-- توزيع طلب قديم، وإعادة الطباعة بترجع نفس الأصناف بالضبط.

create table if not exists public.printers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('receipt', 'station')),
  ip text,
  port int not null default 9100,
  enabled boolean not null default true,
  -- تصنيفات المنتجات (products.category) اللي بتطبعها هالمحطة (للمحطات بس)
  categories text[] not null default '{}',
  -- شبكة أمان: أي صنف تصنيفه مو موزّع على أي محطة بيروح لهالمحطة، حتى
  -- ما يضيع صنف بدون ما ينطبع لو انضاف تصنيف جديد ونسيت توزّعه
  catch_unassigned boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.printers enable row level security;
drop policy if exists printers_rw on public.printers;
create policy printers_rw on public.printers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table public.print_jobs add column if not exists printer_id uuid references public.printers(id) on delete cascade;
-- أرقام أصناف sale_items اللي تخص هالمهمة (null = كل أصناف الطلب)
alter table public.print_jobs add column if not exists item_ids uuid[];

-- نقل إعدادات الطابعتين القديمتين (مطبخ + فاتورة) لجدول الطابعات مرة وحدة
-- بس لو الجدول لسا فاضي، بنفس سلوكهم السابق: الفاتورة كاملة للكاشير،
-- والمطبخ يستقبل كل الأصناف (شبكة أمان بدون تصنيفات محددة)
do $$
declare
  s record;
begin
  if exists (select 1 from public.printers) then return; end if;
  select * into s from public.printer_settings where id = 1;
  if s is null then return; end if;
  if s.receipt_ip is not null then
    insert into public.printers (name, kind, ip, port, enabled, sort_order)
    values ('طابعة الكاشير', 'receipt', s.receipt_ip, s.receipt_port, s.receipt_enabled, 0);
  end if;
  if s.kitchen_ip is not null then
    insert into public.printers (name, kind, ip, port, enabled, catch_unassigned, sort_order)
    values ('طابعة المطبخ', 'station', s.kitchen_ip, s.kitchen_port, s.kitchen_enabled, true, 1);
  end if;
end $$;

-- يوزّع مهمة الطباعة العامة (اللي بيسجلها record_sale: 'kitchen' و'receipt')
-- على الطابعات الفعلية. لو ما في أي طابعة معرّفة بالجدول أصلًا، بيسيب
-- المهمة العامة متل ما هي (المسار القديم بـprint-bridge بيتعامل معها)
create or replace function public.fan_out_print_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_printer record;
  v_item_ids uuid[];
  v_claimed text[];
begin
  if new.printer_id is not null then return new; end if;
  if not exists (select 1 from public.printers) then return new; end if;

  if new.job_type = 'receipt' then
    insert into public.print_jobs (sale_id, job_type, printer_id)
    select new.sale_id, 'receipt', p.id
    from public.printers p where p.enabled and p.kind = 'receipt';
  else
    select coalesce(array_agg(distinct c), '{}') into v_claimed
    from public.printers p, unnest(p.categories) c
    where p.enabled and p.kind = 'station';

    for v_printer in select * from public.printers where enabled and kind = 'station' order by sort_order loop
      select array_agg(si.id) into v_item_ids
      from public.sale_items si
      left join public.products pr on pr.id = si.product_id
      where si.sale_id = new.sale_id and si.status = 'completed'
        and (
          coalesce(pr.category, '') = any(v_printer.categories)
          or (v_printer.catch_unassigned and not (coalesce(pr.category, '') = any(v_claimed)))
        );
      if v_item_ids is not null then
        insert into public.print_jobs (sale_id, job_type, printer_id, item_ids)
        values (new.sale_id, 'kitchen', v_printer.id, v_item_ids);
      end if;
    end loop;
  end if;

  delete from public.print_jobs where id = new.id;
  return new;
end;
$$;

drop trigger if exists print_jobs_fan_out on public.print_jobs;
create trigger print_jobs_fan_out
  after insert on public.print_jobs
  for each row execute function public.fan_out_print_job();
