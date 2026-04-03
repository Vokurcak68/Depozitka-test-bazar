-- Test Bazar (variant 2)
-- Same Supabase project as Depozitka core, but isolated marketplace tables with tb_ prefix.

create extension if not exists pgcrypto;

-- -------------------------
-- TABLES
-- -------------------------

create table if not exists public.tb_listings (
  id uuid primary key default gen_random_uuid(),
  external_listing_id text unique,
  title text not null,
  description text,
  seller_name text not null,
  seller_email text not null,
  price_czk numeric(12,2) not null check (price_czk > 0),
  payment_methods text[] not null default array['Escrow'],
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tb_listings_active on public.tb_listings(is_active, created_at desc);
create index if not exists idx_tb_listings_seller_email on public.tb_listings(lower(seller_email));

create table if not exists public.tb_orders (
  id uuid primary key default gen_random_uuid(),
  external_order_id text not null unique,
  listing_id uuid references public.tb_listings(id) on delete set null,
  listing_title text not null,

  buyer_name text not null,
  buyer_email text not null,
  seller_name text not null,
  seller_email text not null,

  amount_czk numeric(12,2) not null check (amount_czk > 0),
  payment_method text not null default 'Escrow',

  local_status text not null default 'Čeká na platbu',
  escrow_status public.dpt_tx_status not null default 'created',
  escrow_transaction_code text not null unique,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tb_orders_created_at on public.tb_orders(created_at desc);
create index if not exists idx_tb_orders_escrow_code on public.tb_orders(escrow_transaction_code);
create index if not exists idx_tb_orders_buyer_email on public.tb_orders(lower(buyer_email));
create index if not exists idx_tb_orders_seller_email on public.tb_orders(lower(seller_email));

-- -------------------------
-- UPDATED_AT TRIGGER
-- -------------------------

create or replace function public.tb_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tb_listings_updated_at on public.tb_listings;
create trigger trg_tb_listings_updated_at
before update on public.tb_listings
for each row
execute function public.tb_set_updated_at();

drop trigger if exists trg_tb_orders_updated_at on public.tb_orders;
create trigger trg_tb_orders_updated_at
before update on public.tb_orders
for each row
execute function public.tb_set_updated_at();

-- -------------------------
-- STATUS SYNC FUNCTION
-- -------------------------

create or replace function public.tb_map_escrow_status_to_local(p_status public.dpt_tx_status)
returns text
language sql
immutable
as $$
  select case p_status
    when 'created' then 'Čeká na platbu'
    when 'partial_paid' then 'Čeká na platbu'
    when 'paid' then 'Zaplaceno — čeká odeslání'
    when 'shipped' then 'Odesláno'
    when 'delivered' then 'Doručeno — čeká potvrzení'
    when 'completed' then 'Dokončeno ✅'
    when 'auto_completed' then 'Dokončeno ✅'
    when 'payout_sent' then 'Dokončeno ✅'
    when 'payout_confirmed' then 'Dokončeno ✅'
    when 'disputed' then 'Spor ⚠️'
    when 'hold' then 'Pozastaveno'
    when 'refunded' then 'Vráceno'
    when 'cancelled' then 'Zrušeno'
  end;
$$;

create or replace function public.tb_sync_order_from_escrow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marketplace_code text;
begin
  select m.code
    into v_marketplace_code
  from public.dpt_marketplaces m
  where m.id = new.marketplace_id
  limit 1;

  if v_marketplace_code is distinct from 'depozitka-test-bazar' then
    return new;
  end if;

  update public.tb_orders o
  set
    escrow_status = new.status,
    local_status = public.tb_map_escrow_status_to_local(new.status),
    updated_at = now()
  where o.escrow_transaction_code = new.transaction_code;

  return new;
end;
$$;

drop trigger if exists trg_tb_sync_from_escrow on public.dpt_transactions;
create trigger trg_tb_sync_from_escrow
after update of status on public.dpt_transactions
for each row
execute function public.tb_sync_order_from_escrow();

-- -------------------------
-- RLS
-- -------------------------

alter table public.tb_listings enable row level security;
alter table public.tb_orders enable row level security;

-- read for authenticated users
create policy "tb_listings_read_authenticated"
on public.tb_listings
for select
using (auth.role() = 'authenticated');

create policy "tb_orders_read_authenticated"
on public.tb_orders
for select
using (auth.role() = 'authenticated');

-- write only admin/support (reuse depozitka helper)
create policy "tb_listings_write_admin"
on public.tb_listings
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

create policy "tb_orders_write_admin"
on public.tb_orders
for all
using (public.dpt_is_admin())
with check (public.dpt_is_admin());

-- -------------------------
-- SEED
-- -------------------------

insert into public.tb_listings (external_listing_id, title, description, seller_name, seller_email, price_czk, payment_methods)
values
  ('L-1001', 'Tillig 74806 – nákladní vůz H0', 'Testovací inzerát #1', 'Kolejmaster', 'seller1@test.cz', 890, array['Escrow','Převod']),
  ('L-1002', 'Piko SmartControl set + trafo', 'Testovací inzerát #2', 'LokoTom', 'seller2@test.cz', 3490, array['Escrow','Dobírka']),
  ('L-1003', 'Modelová budova nádraží', 'Testovací inzerát #3', 'ModelKing', 'seller3@test.cz', 1250, array['Převod','Dobírka'])
on conflict (external_listing_id) do nothing;
