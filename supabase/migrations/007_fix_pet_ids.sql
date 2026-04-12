-- Fix pet naming inconsistency: pet.shiba → pet.monkey
UPDATE pets SET
  name_key = 'pet.monkey',
  ability_description_key = 'pet.monkey.desc'
WHERE name_key = 'pet.shiba';

-- Convert user_pets.pet_id from UUID FK to text PetId
-- This aligns the DB with the game-engine PetId type ('hamster' | 'rabbit' | 'monkey')

ALTER TABLE user_pets DROP CONSTRAINT IF EXISTS user_pets_pet_id_fkey;
ALTER TABLE user_pets DROP CONSTRAINT IF EXISTS user_pets_user_id_pet_id_key;

ALTER TABLE user_pets ADD COLUMN pet_slug text;

UPDATE user_pets up
SET pet_slug = REPLACE(p.name_key, 'pet.', '')
FROM pets p
WHERE up.pet_id = p.id;

UPDATE user_pets SET pet_slug = 'hamster' WHERE pet_slug IS NULL;

ALTER TABLE user_pets DROP COLUMN pet_id;
ALTER TABLE user_pets RENAME COLUMN pet_slug TO pet_id;

ALTER TABLE user_pets ALTER COLUMN pet_id SET NOT NULL;
ALTER TABLE user_pets ADD CONSTRAINT user_pets_user_id_pet_id_key UNIQUE (user_id, pet_id);
