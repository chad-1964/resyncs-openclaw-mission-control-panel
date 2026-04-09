-- ─────────────────────────────────────────────────────────
-- Mission Control — Database Initialization
-- This runs automatically on first Docker startup
-- ─────────────────────────────────────────────────────────

-- Ensure the database exists with proper charset
ALTER DATABASE IF EXISTS mission_control CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Grant all privileges to the app user
GRANT ALL PRIVILEGES ON mission_control.* TO 'mcadmin'@'%';
FLUSH PRIVILEGES;
