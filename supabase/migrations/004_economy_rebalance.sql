-- Add coupon_value_cents column to products
alter table public.products
  add column if not exists coupon_value_cents int not null default 0;

-- Update existing products: difficulty, water requirements, coupon values
update public.products set difficulty_stars = 1, base_water_required = 21000, coupon_value_cents = 150
  where name_key = 'product.potato';

update public.products set difficulty_stars = 1, base_water_required = 21000, coupon_value_cents = 150
  where name_key = 'product.carrot';

update public.products set difficulty_stars = 2, base_water_required = 35000, coupon_value_cents = 300
  where name_key = 'product.onion';

update public.products set difficulty_stars = 2, base_water_required = 35000, coupon_value_cents = 350
  where name_key = 'product.cucumber';

update public.products set difficulty_stars = 3, base_water_required = 50000, coupon_value_cents = 500
  where name_key = 'product.tomato';
