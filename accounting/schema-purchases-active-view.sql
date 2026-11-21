-- عرض «المشتريات الفعّالة»: سطور المشتريات بدون سطور الفواتير الملغاة (اللي انعدّلت أو انلغت).
-- أي شاشة بتحسب كميات/أسعار/تكرار من المشتريات لازم تقرأ منه بدل جدول purchases.
create or replace view public.purchases_active with (security_invoker = true) as
select p.* from public.purchases p
left join public.purchase_invoices i on i.id = p.invoice_id
where p.invoice_id is null or i.status = 'active';
grant select on public.purchases_active to authenticated;
