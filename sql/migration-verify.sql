-- Verification SQL used during Supabase -> Cloud SQL migration

-- 1) Row counts by table
SELECT 'reports' AS table_name, COUNT(*) AS rows FROM reports
UNION ALL
SELECT 'masters' AS table_name, COUNT(*) AS rows FROM masters
UNION ALL
SELECT 'users' AS table_name, COUNT(*) AS rows FROM users;

-- 2) Latest business date per store
SELECT store_id, MAX(business_date) AS latest_business_date
FROM reports
GROUP BY store_id
ORDER BY store_id;

-- 3) Admin user count
SELECT COUNT(*) AS admin_count
FROM users
WHERE role = 'admin';

-- 4) Exchange rate record
SELECT key, value
FROM masters
WHERE key = 'exchange_rate';
