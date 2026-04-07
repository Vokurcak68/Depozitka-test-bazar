-- 002: Test listing za 100 Kč pro snadnější testování dispute payouts
-- Stejný seller jako L-1001/L-1002 (tomas.vokurka@mujmail.cz)

INSERT INTO public.tb_listings (
  external_listing_id, title, description, seller_name, seller_email,
  price_czk, payment_methods, is_active
)
VALUES (
  'L-TEST-100',
  'Testovací produkt 100 Kč (dispute test)',
  'Levný testovací inzerát pro testování vypořádání sporů — částka záměrně 100 Kč.',
  'Kolejmaster',
  'tomas.vokurka@mujmail.cz',
  100,
  ARRAY['Escrow', 'Převod'],
  true
)
ON CONFLICT (external_listing_id) DO UPDATE
SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  seller_name = EXCLUDED.seller_name,
  seller_email = EXCLUDED.seller_email,
  price_czk = EXCLUDED.price_czk,
  payment_methods = EXCLUDED.payment_methods,
  is_active = true,
  updated_at = now();
