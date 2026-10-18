-- رقم مورّد قصير ودائم (م-001) يميّز كل مورّد عن غيره. ما بيتكرر وما بينعاد حتى لو انحذف مورّد.
-- آمن للتشغيل أكتر من مرة.

create sequence if not exists public.supplier_no_seq;

alter table public.suppliers add column if not exists supplier_no bigint;

-- ترقيم الموردين الحاليين بترتيب إضافتهم (مرة وحدة: بس لو ما في ولا صف مرقّم)
do $$
begin
  if not exists (select 1 from public.suppliers where supplier_no is not null) then
    update public.suppliers s set supplier_no = o.rn
    from (select id, row_number() over (order by created_at, id) rn from public.suppliers) o where s.id = o.id;
    perform setval('public.supplier_no_seq', greatest((select coalesce(max(supplier_no), 0) from public.suppliers), 1),
                   (select count(*) > 0 from public.suppliers));
  end if;
end $$;

create unique index if not exists suppliers_supplier_no_key on public.suppliers (supplier_no);

create or replace function public.assign_supplier_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.supplier_no is null then new.supplier_no := nextval('public.supplier_no_seq'); end if;
  return new;
end;
$$;

revoke execute on function public.assign_supplier_no() from public, anon, authenticated;

create or replace trigger suppliers_assign_supplier_no
  before insert on public.suppliers
  for each row execute function public.assign_supplier_no();
