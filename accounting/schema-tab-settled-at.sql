-- وقت تسديد حساب الطاولة: الحساب المفتوح بالوردية الأولى وانسدّد بالتانية بينحسب كاشه بالتانية
alter table public.sales_entries add column if not exists settled_at timestamptz;

create or replace function public.sales_set_settled_at()
returns trigger language plpgsql as $$
begin
  if old.tab_open and not new.tab_open and new.settled_at is null then
    new.settled_at := now();
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sales_set_settled_at_trg' and tgrelid = 'public.sales_entries'::regclass) then
    create trigger sales_set_settled_at_trg before update on public.sales_entries
      for each row execute function public.sales_set_settled_at();
  end if;
end $$;
