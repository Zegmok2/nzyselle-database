-- Removes the X (Twitter) platform from installs that already ran migration
-- 0002 before X was dropped from the product scope. A fresh install never
-- seeds X in the first place (see 0002), so this is purely cleanup for
-- existing databases. Safe to run multiple times.

DELETE FROM connection_capability WHERE platform_id = 'x';
DELETE FROM metric_definition WHERE platform_id = 'x';
DELETE FROM social_connection WHERE platform_id = 'x';
DELETE FROM platform_definition WHERE id = 'x';
