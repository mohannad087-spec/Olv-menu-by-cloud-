-- حالة فواتير المشتريات بعد الدفعات اللاحقة للمورّد:
-- لما تدفع للمورّد من صفحة الموردين، الدفعة ما بتكون مربوطة بفاتورة معيّنة، فكانت الفاتورة
-- تضل مكتوب عليها «آجل» مع إنها اندفعت. هالعرض بيوزّع دفعات المورّد الحرّة على ديونه
-- من الأقدم للأحدث (FIFO) وبيطلع لكل فاتورة قديش ضايل عليها.
-- ما بيغيّر ولا رقم مخزّن، والدين الكلي للمورّد هو نفسه (supplier_balances).
-- آمن للتشغيل أكثر من مرة.

create or replace view public.purchase_invoice_settlement
with (security_invoker = true) as
with debts as (
  -- كل دين على المورّد: فواتير المشتريات + الديون اليدوية (دين سابق / رصيد افتتاحي)
  -- ناقص اللي اندفع عند الفاتورة نفسها
  select t.id, t.supplier_id, t.invoice_id, t.transaction_date, t.created_at,
    greatest(t.amount - coalesce((
      select sum(p.amount) from public.supplier_transactions p
      where t.invoice_id is not null and p.invoice_id = t.invoice_id and p.type = 'payment'
    ), 0), 0) as open_amount
  from public.supplier_transactions t
  where t.type = 'invoice'
),
pool as (
  -- الدفعات اللي مش مربوطة بفاتورة (من صفحة الموردين)
  select supplier_id, sum(amount) as free_paid
  from public.supplier_transactions
  where type = 'payment' and invoice_id is null
  group by supplier_id
),
run as (
  select d.*,
    coalesce(sum(d.open_amount) over (
      partition by d.supplier_id order by d.transaction_date, d.created_at, d.id
      rows between unbounded preceding and 1 preceding
    ), 0) as older_open
  from debts d
)
select
  r.invoice_id,
  r.supplier_id,
  r.open_amount,
  least(r.open_amount, greatest(coalesce(p.free_paid, 0) - r.older_open, 0)) as settled_later,
  r.open_amount - least(r.open_amount, greatest(coalesce(p.free_paid, 0) - r.older_open, 0)) as remaining
from run r
left join pool p on p.supplier_id = r.supplier_id
where r.invoice_id is not null;

revoke all on public.purchase_invoice_settlement from anon, public;
grant select on public.purchase_invoice_settlement to authenticated;
