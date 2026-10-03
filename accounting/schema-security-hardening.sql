-- سد ثغرتين كانوا بيسمحوا لأي حدا معه رابط Supabase (بدون تسجيل دخول) يقرأ بيانات:
--
--   • app_setting_num(): كانت مفتوحة للعامة عبر /rest/v1/rpc وبترجّع أي إعداد رقمي،
--     ومنها الرقم السري تبع منطقة الخطر. هلأ ما حدا بيناديها من برا، بس الدوال الداخلية
--     (record_sale, void_sale, void_sale_item, reprint_receipt) بتضل تستخدمها لأنها
--     بتشتغل بصلاحية صاحب قاعدة البيانات. وكمان صارت ترفض ترجّع reset_pin نهائيًا
--   • supplier_balances: العرض كان بيتجاوز حماية الجداول. هلأ بيمشي بصلاحية المستخدم
--     نفسه، فبيشوفه المالك والمدير بس (نفس صلاحية supplier_transactions)
-- شغّله بعد schema-cashier-hardening.sql و schema-suppliers.sql

create or replace function public.app_setting_num(p_key text, p_default numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text;
begin
  if p_key = 'reset_pin' then return p_default; end if;
  select value into v from public.app_settings where key = p_key;
  if v is null or trim(v) = '' then return p_default; end if;
  return v::numeric;
exception when others then
  return p_default;
end;
$$;

revoke execute on function public.app_setting_num(text, numeric) from public, anon, authenticated;

alter view public.supplier_balances set (security_invoker = true);
revoke all on public.supplier_balances from anon;
