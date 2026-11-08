-- المبيعات على «حساب موظف» ما بتنطبع أبدًا (لا إيصال ولا ورقة مطبخ/بار).
-- نفس دالة fan_out_print_job الحالية + فحص بالأول: لو ملاحظات البيعة فيها «على حساب الموظف» بنحذف المهمة بدون طباعة.
-- إعادة الطباعة لطابعة محددة (printer_id موجود) ما بتتأثر.
create or replace function public.fan_out_print_job()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_printer record;
  v_item_ids uuid[];
  v_claimed text[];
begin
  if new.printer_id is not null then return new; end if;
  if not exists (select 1 from public.printers) then return new; end if;

  if exists (select 1 from public.sales_entries s where s.id = new.sale_id and s.notes like '%على حساب الموظف%') then
    delete from public.print_jobs where id = new.id;
    return new;
  end if;

  if new.job_type = 'receipt' then
    insert into public.print_jobs (sale_id, job_type, printer_id, reprint_reason, reprint_no, reprint_by)
    select new.sale_id, 'receipt', p.id, new.reprint_reason, new.reprint_no, new.reprint_by
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
$function$;
