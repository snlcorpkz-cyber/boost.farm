-- Seed products
insert into public.products (name_key, difficulty_stars, base_water_required, coupon_validity_days) values
  ('product.potato', 1, 10000, 60),
  ('product.tomato', 3, 10000, 60),
  ('product.carrot', 1, 10000, 60),
  ('product.cucumber', 2, 10000, 60),
  ('product.onion', 3, 10000, 60);

-- Seed quests
insert into public.quests (quest_key, reward_type, reward_amount, limit_per_phase) values
  ('checkin', 'water', 40, 1),
  ('greet_friend', 'water', 12, 10),
  ('watch_ad', 'water', 40, 3),
  ('view_product', 'water', 35, 1),
  ('water_friend', 'nutrition', 2, 10),
  ('daily_challenge', 'water', 100, 1);

-- Seed pets
insert into public.pets (name_key, ability_type, ability_description_key) values
  ('pet.hamster', 'gift_water', 'pet.hamster.desc'),
  ('pet.rabbit', 'bucket_upgrade', 'pet.rabbit.desc'),
  ('pet.shiba', 'bonus_growth', 'pet.shiba.desc');
