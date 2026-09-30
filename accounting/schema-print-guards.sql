-- حمايات إضافية لمنظومة الطباعة:
--   ١) تعديل الطابعات وإعدادات الطباعة للمالك والمدير بس (الكاشير يقدر يشوف
--      بس، ما يقدر يحذف طابعة أو يغيّر توزيع التصنيفات)
--   ٢) حالة "printing": برنامج الطباعة بيحجز المهمة ذرّيًا قبل ما يطبعها، فلو
--      اشتغل على جهازين بالغلط ما بتنطبع التذكرة مرتين
--   ٣) حالة "stale": مهمة تحضير تأخرت أكتر من المدة المسموحة (بعد انقطاع
--      طويل) ما بتنطبع تلقائيًا — بتنتظر قرار الكاشير بدل ما تنطبع طلبات
--      قديمة دفعة وحدة للمطبخ

-- ---------- ١) صلاحيات ----------
drop policy if exists printers_rw on public.printers;
drop policy if exists printers_select on public.printers;
drop policy if exists printers_write on public.printers;
create policy printers_select on public.printers
  for select using (auth.role() = 'authenticated');
create policy printers_write on public.printers
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );

drop policy if exists printer_settings_rw on public.printer_settings;
drop policy if exists printer_settings_select on public.printer_settings;
drop policy if exists printer_settings_write on public.printer_settings;
create policy printer_settings_select on public.printer_settings
  for select using (auth.role() = 'authenticated');
create policy printer_settings_write on public.printer_settings
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );

-- ---------- ٢ + ٣) حالات جديدة للمهام ----------
alter table public.print_jobs add column if not exists claimed_at timestamptz;
alter table public.print_jobs drop constraint if exists print_jobs_status_check;
alter table public.print_jobs
  add constraint print_jobs_status_check
  check (status in ('pending', 'printing', 'printed', 'error', 'skipped', 'stale'));
