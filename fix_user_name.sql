-- fix_user_name.sql
UPDATE profiles 
SET full_name = 'Nicolas Yarur' 
WHERE id = 'de3a3194-29b1-449a-828a-53608a7ebe47';

-- Verify the change
SELECT id, full_name FROM profiles WHERE id = 'de3a3194-29b1-449a-828a-53608a7ebe47';
