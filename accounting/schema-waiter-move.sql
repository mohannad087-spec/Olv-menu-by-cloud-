-- الويتر بينقل حساب طاولة لطاولة ثانية، ولو عليها حساب مفتوح بينضم معه (دمج).
-- بيستدعي move_table_tab نفسها (نفس التحقق والقفل). شغّله بـ SQL Editor، آمن لو انعاد.
create or replace function public.waiter_move_table(p_from text, p_to text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  perform set_config('olv.waiter_rpc', '1', true);
  v_n := public.move_table_tab(p_from, p_to);
  perform set_config('olv.waiter_rpc', '', true);
  return v_n;
end;
$$;

revoke execute on function public.waiter_move_table(text, text) from public, anon;
grant execute on function public.waiter_move_table(text, text) to authenticated;
