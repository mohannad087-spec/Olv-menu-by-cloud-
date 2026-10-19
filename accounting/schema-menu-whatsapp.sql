-- سجل رسائل «طلبك جاهز» على واتساب (WhatsApp Business) لطلبات المنيو.
-- الدالة olv-menu-proxy بتسجّل الطلب هون قبل ما تبعت، فلو الكاشير والمطبخ بلّغوا سوا بتروح رسالة وحدة بس.
-- بس السيرفر (service role) بيقرأ ويكتب: RLS مفعّل وبدون سياسات.
create table if not exists public.menu_whatsapp_log (
  order_id text primary key,
  phone text not null,
  sent_at timestamptz not null default now(),
  ok boolean,
  error text
);
alter table public.menu_whatsapp_log enable row level security;
revoke all on public.menu_whatsapp_log from anon, authenticated;
