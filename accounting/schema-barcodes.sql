-- باركودات الأصناف: كل كود مربوط بمادة خام أو مستلزم، وبيعرف إذا هو كود الحبة (وحدة المخزون)
-- أو كود الكرتونة (وحدة الشراء). الصنف الواحد ممكن يكون إله أكتر من كود (حجمين، موردين).
-- بيتعبّى من صفحة فواتير الشراء أول مرة بينمسح كود جديد. آمن تشغيله أكتر من مرة.
create table if not exists public.item_barcodes (
  code text primary key check (length(code) between 3 and 64),
  item_kind text not null check (item_kind in ('ingredient', 'supply')),
  item_id uuid not null,
  unit_mode text not null default 'stock' check (unit_mode in ('stock', 'purchase')),
  created_at timestamptz not null default now()
);
create index if not exists item_barcodes_item_idx on public.item_barcodes (item_kind, item_id);

alter table public.item_barcodes enable row level security;
drop policy if exists item_barcodes_select on public.item_barcodes;
create policy item_barcodes_select on public.item_barcodes for select using (auth_role() is not null);
drop policy if exists item_barcodes_admin_write on public.item_barcodes;
create policy item_barcodes_admin_write on public.item_barcodes for all using (is_admin()) with check (is_admin());
