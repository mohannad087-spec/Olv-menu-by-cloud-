-- رقم تسلسلي دائم لكل فاتورة بيع (ب-0001) وكل فاتورة شراء (ش-0001).
-- مختلف عن «رقم الطلب» اليومي (بيرجع يبدأ كل يوم) وعن رقم فاتورة المورّد (بيكتبه المستخدم).
-- الأرقام ما بتتكرر وما بتنعاد حتى لو انلغت الفاتورة. آمن للتشغيل أكتر من مرة.

create sequence if not exists public.sale_doc_seq;
create sequence if not exists public.purchase_doc_seq;

alter table public.sales_entries add column if not exists doc_no bigint;
alter table public.purchase_invoices add column if not exists doc_no bigint;

-- ترقيم الفواتير القديمة بترتيب وقتها (مرة وحدة: بس لو ما في ولا صف مرقّم)
do $$
begin
  if not exists (select 1 from public.sales_entries where doc_no is not null) then
    update public.sales_entries s set doc_no = o.rn
    from (select id, row_number() over (order by created_at, id) rn from public.sales_entries) o where s.id = o.id;
    perform setval('public.sale_doc_seq', greatest((select coalesce(max(doc_no), 0) from public.sales_entries), 1),
                   (select count(*) > 0 from public.sales_entries));
  end if;
  if not exists (select 1 from public.purchase_invoices where doc_no is not null) then
    update public.purchase_invoices p set doc_no = o.rn
    from (select id, row_number() over (order by created_at, id) rn from public.purchase_invoices) o where p.id = o.id;
    perform setval('public.purchase_doc_seq', greatest((select coalesce(max(doc_no), 0) from public.purchase_invoices), 1),
                   (select count(*) > 0 from public.purchase_invoices));
  end if;
end $$;

create unique index if not exists sales_entries_doc_no_key on public.sales_entries (doc_no);
create unique index if not exists purchase_invoices_doc_no_key on public.purchase_invoices (doc_no);

create or replace function public.assign_sale_doc_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.doc_no is null then new.doc_no := nextval('public.sale_doc_seq'); end if;
  return new;
end;
$$;

create or replace function public.assign_purchase_doc_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.doc_no is null then new.doc_no := nextval('public.purchase_doc_seq'); end if;
  return new;
end;
$$;

revoke execute on function public.assign_sale_doc_no() from public, anon, authenticated;
revoke execute on function public.assign_purchase_doc_no() from public, anon, authenticated;

create or replace trigger sales_entries_assign_doc_no
  before insert on public.sales_entries
  for each row execute function public.assign_sale_doc_no();

create or replace trigger purchase_invoices_assign_doc_no
  before insert on public.purchase_invoices
  for each row execute function public.assign_purchase_doc_no();
