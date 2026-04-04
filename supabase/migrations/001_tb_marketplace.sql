-- Depozitka test bazar schema (tb_*)
-- Variant 2: independent marketplace app with own local tables + push to depozitka-core API

create extension if not exists pgcrypto;

create table if not exists public.tb_listings (
  id uuid primary key default gen_random_uuid(),
  external_listing_id text unique not null,
  title text not null,
  description text,
  seller_name text not null,
  seller_email text not null,
  price_czk numeric(12,2) not null check (price_czk > 0),
  payment_methods text[] not null default array['Escrow'],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tb_listings_active on public.tb_listings(is_active);
create index if not exists idx_tb_listings_seller_email on public.tb_listings(lower(seller_email));

create table if not exists public.tb_orders (
  id uuid primary key default gen_random_uuid(),
  external_order_id text unique not null,
  listing_id uuid references public.tb_listings(id) on delete restrict,
  listing_title text not null,

  buyer_name text not null,
  buyer_email text not null,
  seller_name text not null,
  seller_email text not null,

  amount_czk numeric(12,2) not null check (amount_czk > 0),
  payment_method text not null default 'Escrow',

  -- local order lifecycle in bazar app
  local_status text not null default 'created',

  -- depozitka linkage
  escrow_transaction_code text,
  escrow_status text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tb_orders_created_at on public.tb_orders(created_at desc);
create index if not exists idx_tb_orders_escrow_tx on public.tb_orders(escrow_transaction_code);
create index if not exists idx_tb_orders_seller_email on public.tb_orders(lower(seller_email));

-- Generic updated_at trigger
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
for each row execute function public.tb_set_updated_at();

drop trigger if exists trg_tb_orders_updated_at on public.tb_orders;
create trigger trg_tb_orders_updated_at
before update on public.tb_orders
for each row execute function public.tb_set_updated_at();

-- Sync helper from depozitka-core status events (called by connector app)
create or replace function public.tb_sync_from_escrow(
  p_transaction_code text,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tb_orders
     set escrow_status = p_new_status,
         local_status = case
           when p_new_status in ('completed', 'auto_completed', 'refunded', 'cancelled') then 'closed'
           when p_new_status in ('paid','shipped','delivered','hold','disputed','payout_sent','payout_confirmed') then 'in_progress'
           else local_status
         end,
         updated_at = now()
   where escrow_transaction_code = p_transaction_code;
end;
$$;

grant execute on function public.tb_sync_from_escrow(text, text, text) to authenticated;

-- Connector helper: create local order + push to depozitka-core via API key auth function
create or replace function public.tb_create_order_and_push_escrow(
  p_external_order_id text,
  p_listing_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_payment_method text default 'Escrow',
  p_api_key text default null
)
returns table(
  order_id uuid,
  escrow_transaction_code text,
  escrow_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.tb_listings%rowtype;
  v_order public.tb_orders%rowtype;
  v_tx record;
  v_marketplace_code text;
  v_mp_id uuid;
begin
  select * into v_listing
  from public.tb_listings
  where id = p_listing_id
    and is_active = true;

  if v_listing.id is null then
    raise exception 'Listing not found or inactive';
  end if;

  insert into public.tb_orders (
    external_order_id,
    listing_id,
    listing_title,
    buyer_name,
    buyer_email,
    seller_name,
    seller_email,
    amount_czk,
    payment_method,
    local_status
  )
  values (
    p_external_order_id,
    v_listing.id,
    v_listing.title,
    p_buyer_name,
    lower(trim(p_buyer_email)),
    v_listing.seller_name,
    lower(trim(v_listing.seller_email)),
    v_listing.price_czk,
    p_payment_method,
    'created'
  )
  returning * into v_order;

  -- API-key scoped marketplace auth
  select marketplace_id, marketplace_code
    into v_mp_id, v_marketplace_code
  from public.dpt_api_auth_marketplace(p_api_key, array['orders:create']);

  if v_marketplace_code is distinct from 'depozitka-test-bazar' then
    raise exception 'API key marketplace mismatch (%). Expected depozitka-test-bazar', coalesce(v_marketplace_code,'null');
  end if;

  -- Push to depozitka-core safely (marketplace enforced by API key)
  select *
    into v_tx
  from public.dpt_create_transaction_safe(
    p_api_key            => p_api_key,
    p_external_order_id  => v_order.external_order_id,
    p_buyer_name         => v_order.buyer_name,
    p_buyer_email        => v_order.buyer_email,
    p_seller_name        => v_order.seller_name,
    p_seller_email       => v_order.seller_email,
    p_amount_czk         => v_order.amount_czk,
    p_payment_method     => v_order.payment_method
  );

  update public.tb_orders
     set escrow_transaction_code = v_tx.transaction_code,
         escrow_status = v_tx.status,
         local_status = 'in_progress',
         updated_at = now()
   where id = v_order.id;

  return query
  select v_order.id, v_tx.transaction_code, v_tx.status;
end;
$$;

grant execute on function public.tb_create_order_and_push_escrow(text, uuid, text, text, text, text) to authenticated;

-- Basic read/write policies for authenticated users
alter table public.tb_listings enable row level security;
alter table public.tb_orders enable row level security;

drop policy if exists tb_listings_read on public.tb_listings;
create policy tb_listings_read on public.tb_listings
for select to authenticated
using (true);

drop policy if exists tb_orders_rw on public.tb_orders;
create policy tb_orders_rw on public.tb_orders
for all to authenticated
using (true)
with check (true);

-- Seed sample listings
insert into public.tb_listings (external_listing_id, title, description, seller_name, seller_email, price_czk, payment_methods)
values
  ('L-1001', 'Tillig 74806 – nákladní vůz H0', 'Testovací inzerát #1', 'Kolejmaster', 'tomas.vokurka@mujmail.cz', 890, array['Escrow','Převod']),
  ('L-1002', 'Piko SmartControl set + trafo', 'Testovací inzerát #2', 'LokoTom', 'tomas.vokurka@mujmail.cz', 3490, array['Escrow','Dobírka']),
  ('L-1003', 'Modelová budova nádraží', 'Testovací inzerát #3', 'ModelKing', 'seller3@test.cz', 1250, array['Převod','Dobírka'])
on conflict (external_listing_id) do update
  set title = excluded.title,
      description = excluded.description,
      seller_name = excluded.seller_name,
      seller_email = excluded.seller_email,
      price_czk = excluded.price_czk,
      payment_methods = excluded.payment_methods,
      is_active = true,
      updated_at = now();
