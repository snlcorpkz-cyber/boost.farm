-- Telegram Mini App: link accounts by Telegram user id
alter table public.users add column if not exists telegram_id bigint unique;

create index if not exists idx_users_telegram_id on public.users(telegram_id) where telegram_id is not null;
