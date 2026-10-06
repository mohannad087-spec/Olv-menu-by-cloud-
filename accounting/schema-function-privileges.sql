-- تقليل سطح الـAPI: دوال التريغرات ما لازم تنادى من REST أصلًا، ودوال تجهيز الطلبيات للمسجّلين فقط.
-- (طُبّق على قاعدة الإنتاج؛ شغّله على أي نسخة جديدة بعد schema-purchase-orders.sql)
revoke execute on function public._tg_reprice_menu_stock() from public, anon, authenticated;
revoke execute on function public.assign_order_no() from public, anon, authenticated;
revoke execute on function public.cancel_item_print() from public, anon, authenticated;
revoke execute on function public.cancel_sale_print() from public, anon, authenticated;
revoke execute on function public.fan_out_print_job() from public, anon, authenticated;
revoke execute on function public.force_actor() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.log_audit() from public, anon, authenticated;
revoke execute on function public.protect_profile_privileges() from public, anon, authenticated;
revoke execute on function public.save_purchase_order(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.set_purchase_order_status(uuid, text) from public, anon;
grant execute on function public.save_purchase_order(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.set_purchase_order_status(uuid, text) to authenticated;
alter function public._smart_price(numeric, numeric) set search_path = public;
notify pgrst, 'reload schema';
