-- تسريع قاعدة البيانات (تنبيهات Supabase للأداء):
-- 1) فهرس لكل رابط بين جدولين (foreign key) ما إله فهرس — بيسرّع الحذف والربط بين الجداول.
-- 2) سياسات الصلاحيات (RLS) صارت تحسب auth.uid() مرة وحدة بالاستعلام بدل مرة لكل سطر.
--    نفس الشروط بالضبط، بس ملفوفة بـ (select ...).
-- آمن للتشغيل أكثر من مرة.

create index if not exists addon_ingredients_ingredient_id_fk_idx on public.addon_ingredients (ingredient_id);
create index if not exists cash_closings_closed_by_fk_idx on public.cash_closings (closed_by);
create index if not exists expenses_category_id_fk_idx on public.expenses (category_id);
create index if not exists expenses_created_by_fk_idx on public.expenses (created_by);
create index if not exists expenses_recurring_id_fk_idx on public.expenses (recurring_id);
create index if not exists payroll_payments_paid_by_fk_idx on public.payroll_payments (paid_by);
create index if not exists print_jobs_printer_id_fk_idx on public.print_jobs (printer_id);
create index if not exists product_ingredients_ingredient_id_fk_idx on public.product_ingredients (ingredient_id);
create index if not exists purchase_invoices_created_by_fk_idx on public.purchase_invoices (created_by);
create index if not exists purchase_invoices_expense_id_fk_idx on public.purchase_invoices (expense_id);
create index if not exists purchase_invoices_voided_by_fk_idx on public.purchase_invoices (voided_by);
create index if not exists purchase_order_lines_ingredient_id_fk_idx on public.purchase_order_lines (ingredient_id);
create index if not exists purchase_order_lines_supply_id_fk_idx on public.purchase_order_lines (supply_id);
create index if not exists purchase_orders_created_by_fk_idx on public.purchase_orders (created_by);
create index if not exists purchases_created_by_fk_idx on public.purchases (created_by);
create index if not exists purchases_expense_id_fk_idx on public.purchases (expense_id);
create index if not exists purchases_supplier_id_fk_idx on public.purchases (supplier_id);
create index if not exists receipt_reprints_printed_by_fk_idx on public.receipt_reprints (printed_by);
create index if not exists recurring_expense_runs_expense_id_fk_idx on public.recurring_expense_runs (expense_id);
create index if not exists recurring_expenses_category_id_fk_idx on public.recurring_expenses (category_id);
create index if not exists recurring_expenses_created_by_fk_idx on public.recurring_expenses (created_by);
create index if not exists salary_advances_created_by_fk_idx on public.salary_advances (created_by);
create index if not exists salary_advances_settled_payroll_id_fk_idx on public.salary_advances (settled_payroll_id);
create index if not exists sale_items_voided_by_fk_idx on public.sale_items (voided_by);
create index if not exists sales_entries_created_by_fk_idx on public.sales_entries (created_by);
create index if not exists sales_entries_voided_by_fk_idx on public.sales_entries (voided_by);
create index if not exists supplier_items_ingredient_id_fk_idx on public.supplier_items (ingredient_id);
create index if not exists supplier_items_supply_id_fk_idx on public.supplier_items (supply_id);
create index if not exists supplier_transactions_created_by_fk_idx on public.supplier_transactions (created_by);
create index if not exists supplier_transactions_invoice_id_fk_idx on public.supplier_transactions (invoice_id);
create index if not exists supplies_supplier_id_fk_idx on public.supplies (supplier_id);

-- ---------- السياسات: نفس الشرط، auth.uid() بينحسب مرة وحدة ----------
alter policy employee_punches_select on public.employee_punches
  using ((profile_id = (select auth.uid())) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
alter policy employee_punches_write on public.employee_punches
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
alter policy payroll_payments_insert on public.payroll_payments
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
alter policy payroll_payments_select on public.payroll_payments
  using ((profile_id = (select auth.uid())) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
alter policy printer_settings_write on public.printer_settings
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
alter policy printers_write on public.printers
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
alter policy profiles_insert_own on public.profiles
  with check (((select auth.uid()) = id) and role = 'staff');
alter policy profiles_select on public.profiles
  using ((id = (select auth.uid())) or public.is_admin());
alter policy profiles_update on public.profiles
  using (((select auth.uid()) = id) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')))
  with check (((select auth.uid()) = id) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
alter policy salary_advances_select on public.salary_advances
  using ((profile_id = (select auth.uid())) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
alter policy salary_advances_write on public.salary_advances
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager')));
