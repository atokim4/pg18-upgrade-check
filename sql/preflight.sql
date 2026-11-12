-- pg18-upgrade-check: read-only preflight for a PostgreSQL 12-17 cluster you plan to move to 18.
--
-- Run it on the OLD cluster as a superuser (pg_upgrade needs one anyway):
--   psql -X -d <db> -f sql/preflight.sql
-- Sections 1, 2, 3, 9 and 10 are cluster-wide. Sections 4-8 look at the database you connect to,
-- so run the file once per application database.
-- Nothing here writes: every statement is a SELECT or SHOW, and the session is set read-only.

\set ON_ERROR_STOP on
SET default_transaction_read_only = on;
\pset footer off
\pset null '-'

\echo '== 1. Server and data checksums =='
\echo 'PG 18 initdb enables data checksums by default. pg_upgrade needs the old and new cluster to match.'
\echo 'If data_checksums is off here, run initdb for 18 with --no-data-checksums'
\echo '(Docker: POSTGRES_INITDB_ARGS=--no-data-checksums), or turn them on in the old cluster with pg_checksums --enable while it is stopped.'
SELECT current_setting('server_version') AS server_version,
       current_setting('data_checksums') AS data_checksums,
       current_setting('data_directory') AS data_directory;

\echo
\echo '== 2. Roles with MD5 password hashes =='
\echo 'PG 18 deprecates MD5 passwords: CREATE/ALTER ROLE ... PASSWORD with an MD5 hash now emits a warning'
\echo '(md5_password_warnings = off silences it). pg_upgrade copies existing MD5 hashes over unchanged.'
\echo 'Move these roles to SCRAM: SET password_encryption = ''scram-sha-256''; then \\password <role> (or ALTER ROLE ... PASSWORD).'
SELECT rolname,
       rolcanlogin AS can_login
FROM pg_authid
WHERE rolpassword LIKE 'md5%'
ORDER BY rolname;
SELECT current_setting('password_encryption') AS password_encryption;

\echo
\echo '== 3. pg_hba.conf lines that still say md5 =='
SELECT line_number, type, database, user_name, address, auth_method
FROM pg_hba_file_rules
WHERE auth_method = 'md5'
ORDER BY line_number;

\echo
\echo '== 4. Extended statistics (CREATE STATISTICS) in this database =='
\echo 'pg_upgrade 18 carries most optimizer statistics over, but not these. ANALYZE their tables after the upgrade:'
SELECT s.stxnamespace::regnamespace AS schema,
       s.stxname AS statistics_name,
       s.stxrelid::regclass AS table_name,
       array_to_string(s.stxkind, ',') AS kinds,
       format('ANALYZE %s;', s.stxrelid::regclass) AS run_after_upgrade
FROM pg_statistic_ext s
ORDER BY 1, 2;

\echo
\echo '== 5. Installed extensions in this database =='
\echo 'Each one must be installed for PG 18 on the new server (same or newer version) before pg_upgrade runs.'
SELECT e.extname AS extension,
       e.extversion AS installed,
       a.default_version AS available_here
FROM pg_extension e
LEFT JOIN pg_available_extensions a ON a.name = e.extname
ORDER BY e.extname;

\echo
\echo '== 6. Columns using reg* types that pg_upgrade refuses =='
\echo 'pg_upgrade stops on user columns of these OID-referencing types. Change them to text or oid first.'
SELECT c.oid::regclass AS table_name,
       a.attname AS column_name,
       a.atttypid::regtype AS type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'm', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND a.atttypid IN ('regcollation'::regtype, 'regconfig'::regtype, 'regdictionary'::regtype,
                     'regnamespace'::regtype, 'regoper'::regtype, 'regoperator'::regtype,
                     'regproc'::regtype, 'regprocedure'::regtype)
ORDER BY 1, 2;

\echo
\echo '== 7. Unlogged partitioned tables =='
\echo 'PG 18 rejects CREATE UNLOGGED TABLE ... PARTITION BY. pg_upgrade and pg_dump 18 bring these parents over as plain tables,'
\echo 'so the upgrade itself is fine; update any migration or setup script that still creates them.'
SELECT c.oid::regclass AS partitioned_table
FROM pg_class c
WHERE c.relkind = 'p' AND c.relpersistence = 'u'
ORDER BY 1;

\echo
\echo '== 8. Inheritance parents (not partitions) =='
\echo 'In PG 18, VACUUM and ANALYZE on a parent also process its inheritance children. Use VACUUM ONLY / ANALYZE ONLY to keep the old behaviour.'
SELECT i.inhparent::regclass AS parent,
       count(*) AS children
FROM pg_inherits i
JOIN pg_class p ON p.oid = i.inhparent
WHERE p.relkind = 'r'
GROUP BY i.inhparent
ORDER BY 1;

\echo
\echo '== 9. Database sizes =='
\echo 'Dump/restore time grows with size; pg_upgrade --link time mostly does not.'
SELECT datname AS database,
       pg_size_pretty(pg_database_size(datname)) AS size
FROM pg_database
WHERE datallowconn
ORDER BY pg_database_size(datname) DESC;

\echo
\echo '== 10. Databases whose default collation provider is not libc =='
\echo 'PG 18 full text search and pg_trgm use the database collation provider instead of always libc.'
\echo 'For databases listed here, REINDEX full-text-search and pg_trgm indexes after pg_upgrade. PG 14 and older only have libc.'
SELECT current_setting('server_version_num')::int >= 150000 AS has_locale_provider \gset
\if :has_locale_provider
SELECT datname AS database,
       CASE datlocprovider WHEN 'i' THEN 'icu' WHEN 'b' THEN 'builtin' ELSE datlocprovider::text END AS provider
FROM pg_database
WHERE datlocprovider <> 'c'
ORDER BY datname;
\else
\echo '(server is older than 15: every database uses libc, nothing to do)'
\endif
