-- Rebalance products into 2 categories: Easy (★1) and Hard (★2)
-- Easy  (potato, carrot, onion):    40,420g water
-- Hard  (cucumber, tomato):         62,500g water

UPDATE products SET difficulty_stars = 1, base_water_required = 40420 WHERE name_key = 'product.potato';
UPDATE products SET difficulty_stars = 1, base_water_required = 40420 WHERE name_key = 'product.carrot';
UPDATE products SET difficulty_stars = 1, base_water_required = 40420 WHERE name_key = 'product.onion';
UPDATE products SET difficulty_stars = 2, base_water_required = 62500 WHERE name_key = 'product.cucumber';
UPDATE products SET difficulty_stars = 2, base_water_required = 62500 WHERE name_key = 'product.tomato';
