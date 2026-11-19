-- مواد تضل «متوفرة» بالمنيو والكاشير حتى لو مخزونها صفر أو سالب (مثلًا ماء 500 مل لحد ما يتعمل جرد)
alter table public.ingredients add column if not exists menu_always_available boolean not null default false;
