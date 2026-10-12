-- زر «سدّد هالفاتورة» بصفحة المشتريات:
-- الدفعة بتنسجّل دفعة عادية للمورّد (supplier_transactions بدون invoice_id، فالسياسات والقفل متل ما هم)،
-- بس بتحمل applies_to_invoice، فبتروح لهالفاتورة بالذات بدل ما تتوزّع من الأقدم.
-- الدين الكلي للمورّد ما بيتغيّر (supplier_balances بتجمع كل الدفعات متل قبل).
-- إذا الفاتورة انلغت بعدين، الدفعة بترجع تتوزّع على باقي الديون من الأقدم.
-- بيحلّ محل العرض بـ schema-invoice-settlement.sql. آمن للتشغيل أكثر من مرة.

alter table public.supplier_transactions
  add column if not exists applies_to_invoice uuid references public.purchase_invoices(id) on delete set null;
create index if not exists supplier_transactions_applies_to_invoice_idx
  on public.supplier_transactions (applies_to_invoice);

create or replace view public.purchase_invoice_settlement
with (security_invoker = true) as
with debts as (
  -- كل دين على المورّد: فواتير المشتريات + الديون اليدوية (دين سابق / رصيد افتتاحي)
  -- ناقص اللي اندفع عند الفاتورة نفسها
  select t.id, t.supplier_id, t.invoice_id, t.transaction_date, t.created_at,
    greatest(t.amount - coalesce((
      select sum(p.amount) from public.supplier_transactions p
      where t.invoice_id is not null and p.invoice_id = t.invoice_id and p.type = 'payment'
    ), 0), 0) as gross_open
  from public.supplier_transactions t
  where t.type = 'invoice'
),
targeted as (
  -- دفعات «سدّد هالفاتورة»: بتنحسب للفاتورة نفسها أول شي (لحد قيمتها)
  select d.*,
    least(d.gross_open, coalesce((
      select sum(p.amount) from public.supplier_transactions p
      where d.invoice_id is not null and p.type = 'payment' and p.invoice_id is null
        and p.applies_to_invoice = d.invoice_id
    ), 0)) as targeted_paid
  from debts d
),
pool as (
  -- الدفعات الحرّة (من صفحة الموردين) + اللي زاد من الدفعات الموجّهة، بتتوزّع من الأقدم
  select f.supplier_id,
    f.free_paid - coalesce((select sum(x.targeted_paid) from targeted x where x.supplier_id = f.supplier_id), 0) as free_paid
  from (
    select supplier_id, sum(amount) as free_paid
    from public.supplier_transactions
    where type = 'payment' and invoice_id is null
    group by supplier_id
  ) f
),
run as (
  select x.*, x.gross_open - x.targeted_paid as open_amount,
    coalesce(sum(x.gross_open - x.targeted_paid) over (
      partition by x.supplier_id order by x.transaction_date, x.created_at, x.id
      rows between unbounded preceding and 1 preceding
    ), 0) as older_open
  from targeted x
)
select
  r.invoice_id,
  r.supplier_id,
  r.gross_open as open_amount,
  r.targeted_paid + least(r.open_amount, greatest(coalesce(p.free_paid, 0) - r.older_open, 0)) as settled_later,
  r.open_amount - least(r.open_amount, greatest(coalesce(p.free_paid, 0) - r.older_open, 0)) as remaining
from run r
left join pool p on p.supplier_id = r.supplier_id
where r.invoice_id is not null;

revoke all on public.purchase_invoice_settlement from anon, public;
grant select on public.purchase_invoice_settlement to authenticated;
