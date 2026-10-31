-- مصروفات الدرج (2026-10-31): المصروف بيعتبر «من الدرج» بس لو الكاشير/صاحب المحل حدد هيك وقت التسجيل.
-- المشتريات (كاش/آجل/بنك) والثابتة والذمة مالها علاقة بالدرج.
alter table public.expenses add column if not exists from_drawer boolean not null default false;

-- المصاريف القديمة: اليدوية الكاش (مش ثابتة ومش من فواتير المشتريات) كانت أصلاً محسوبة بالدرج، فبتنعلّم «من الدرج».
update public.expenses e set from_drawer = true
where e.payment_type = 'cash' and e.recurring_id is null and not e.from_drawer
  and not exists (select 1 from public.purchase_invoices pi where pi.expense_id = e.id)
  and not exists (select 1 from public.purchases pu where pu.expense_id = e.id);
