-- البيع على «حساب موظف» بدون رمز المدير: الكاشير بيطلب موافقة خصم تلقائية لبيعة وحدة (3 دقايق)
-- الذمة بتنسجّل على الموظف وبتنخصم من راتبه، والعملية بتنكتب بسجل التدقيق.
create or replace function public.staff_account_approval()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_exp timestamptz := now() + interval '3 minutes';
  v_id bigint;
  v_name text;
begin
  if v_role is null or v_role not in ('owner', 'manager', 'staff') then
    raise exception 'غير مصرّح';
  end if;
  -- حماية: 30 بيعة على حساب موظف بالساعة كحد أقصى لكل مستخدم
  if (select count(*) from public.approvals
        where for_user = auth.uid() and kind = 'discount' and approved_by = auth.uid()
          and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'عدد كبير من المبيعات على الحساب بآخر ساعة — بلّغ المدير';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.approvals (for_user, kind, approved_by, approved_by_name, expires_at)
  values (auth.uid(), 'discount', auth.uid(), 'حساب موظف (تلقائي)', v_exp)
  returning id into v_id;
  insert into public.audit_log (actor, actor_name, table_name, op, row_id, new_data)
  values (auth.uid(), v_name, 'approvals', 'APPROVE', v_id::text, jsonb_build_object('kind', 'discount', 'via', 'staff_account'));
  return v_exp;
end;
$$;
revoke all on function public.staff_account_approval() from public, anon;
grant execute on function public.staff_account_approval() to authenticated;
