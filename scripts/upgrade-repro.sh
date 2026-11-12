#!/usr/bin/env bash
# Reproduces a PostgreSQL 14 -> 18 upgrade end to end on a generated database, without root or Docker:
#   1. initdb 14 with defaults, load sample data (~1-2 GB), add the things PG 18 treats differently
#   2. run sql/preflight.sql on the 14 cluster
#   3. pg_upgrade --check against a default 18 initdb (data checksums on)
#   4. pg_upgrade --link against an 18 initdb with --no-data-checksums, timed
#   5. look at what came over: column stats, extended stats, MD5 roles
#   6. for comparison, a pg_dumpall | psql copy of the same 14 data into a fresh 18 cluster, timed
#
# Usage: scripts/upgrade-repro.sh <binaries-dir> <work-dir> [rows]
#   <binaries-dir>  the directory scripts/pgdg-fetch.sh unpacked 14 and 18 into
#   <work-dir>      scratch directory for clusters and sockets (must not exist or be empty)
#   rows            rows in the sample orders table (default 12000000, about 1.5 GB with indexes)
# Everything is printed to stdout; tee it to keep a transcript.
set -euo pipefail

if [ $# -lt 2 ]; then
	echo "usage: $0 <binaries-dir> <work-dir> [rows]" >&2
	exit 2
fi
bin_root=$(realpath "$1")
work=$(realpath -m "$2")
rows=${3:-12000000}
here=$(cd "$(dirname "$0")/.." && pwd)

export LD_LIBRARY_PATH="$bin_root/usr/lib/x86_64-linux-gnu"
B14="$bin_root/usr/lib/postgresql/14/bin"
B18="$bin_root/usr/lib/postgresql/18/bin"
sock="$work/sock"
mkdir -p "$work" "$sock"
if [ -n "$(ls -A "$work" | grep -v '^sock$')" ]; then
	echo "work dir is not empty: $work" >&2
	exit 2
fi

started=()
cleanup() {
	for d in "${started[@]}"; do
		"$B18/pg_ctl" -D "$d" -m fast stop >/dev/null 2>&1 || "$B14/pg_ctl" -D "$d" -m fast stop >/dev/null 2>&1 || true
	done
}
trap cleanup EXIT

step() { printf '\n### %s\n' "$*"; }
now() { date +%s.%N; }
took() { awk -v a="$1" -v b="$(now)" 'BEGIN { printf "took %.1f s\n", b - a }'; }

start() { # <bin> <datadir> <port>
	"$1/pg_ctl" -D "$2" -l "$2.log" -w -o "-p $3 -k $sock -c listen_addresses='' -c jit=off" start >/dev/null
	started+=("$2")
}
stop() { # <bin> <datadir>
	"$1/pg_ctl" -D "$2" -m fast -w stop >/dev/null
}
q14() { "$B14/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" -p 54314 -U postgres "$@"; }
q18() { "$B18/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" -p 54318 -U postgres "$@"; }

step "versions"
"$B14/postgres" --version
"$B18/postgres" --version
uname -srm
nproc | sed 's/^/cpus: /'

step "initdb 14 with defaults"
"$B14/initdb" -D "$work/data14" -U postgres -A trust >/dev/null
start "$B14" "$work/data14" 54314
q14 -Atc "SHOW data_checksums" | sed 's/^/14 data_checksums: /'
"$B14/pg_controldata" "$work/data14" | grep -i 'checksum version' | sed 's/^/14 default initdb: /'

step "load sample data: $rows orders, extended statistics, an MD5 role, contrib extensions"
t=$(now)
q14 -d postgres <<SQL
CREATE DATABASE shop;
\c shop
CREATE EXTENSION pg_trgm;
CREATE EXTENSION hstore;
CREATE TABLE customers (id int PRIMARY KEY, city text NOT NULL, country text NOT NULL);
INSERT INTO customers
SELECT g, 'city-' || (g % 500), 'country-' || (g % 50) FROM generate_series(1, 200000) g;
CREATE TABLE orders (
  id bigint PRIMARY KEY,
  customer_id int NOT NULL REFERENCES customers,
  status text NOT NULL,
  amount numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL,
  note text
);
INSERT INTO orders
SELECT g, 1 + (g % 200000), (ARRAY['new','paid','shipped','done'])[1 + g % 4],
       (g % 10000) / 100.0, timestamptz '2024-01-01' + (g % 31536000) * interval '1 second',
       md5(g::text)
FROM generate_series(1, $rows) g;
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_created_idx ON orders (created_at);
CREATE INDEX customers_city_trgm ON customers USING gin (city gin_trgm_ops);
CREATE STATISTICS customers_city_country (dependencies, ndistinct) ON city, country FROM customers;
CREATE TABLE events (id int, payload text);
CREATE TABLE events_2025 () INHERITS (events);
SET password_encryption = 'md5';
CREATE ROLE legacy_app LOGIN PASSWORD 'sample-only';
ANALYZE;
SQL
took "$t"
q14 -Atc "SELECT 'shop size: ' || pg_size_pretty(pg_database_size('shop'))"

step "unlogged partitioned table on 14 (separate database, so it does not stop the shop upgrade)"
q14 -d postgres -c "CREATE DATABASE parts"
q14 -d parts -c "CREATE UNLOGGED TABLE metrics (ts timestamptz, v int) PARTITION BY RANGE (ts)" && \
	q14 -d parts -Atc "SELECT 'metrics relpersistence on 14: ' || relpersistence::text FROM pg_class WHERE relname = 'metrics'"

step "sql/preflight.sql on the 14 cluster (database shop)"
q14 -d shop -P pager=off -f "$here/sql/preflight.sql"
echo "section 7 of the same file, run on database parts:"
q14 -d parts -P pager=off -f "$here/sql/preflight.sql" | sed -n '/== 7/,/== 8/p' | sed '$d'

step "pg_upgrade --check against a default 18 initdb"
"$B18/initdb" -D "$work/data18-default" -U postgres -A trust >/dev/null
stop "$B14" "$work/data14"
"$B18/pg_controldata" "$work/data18-default" | grep -i 'checksum version' | sed 's/^/18 default initdb: /'
cd "$work"
set +e
"$B18/pg_upgrade" --check -b "$B14" -B "$B18" -d "$work/data14" -D "$work/data18-default" -U postgres -s "$sock" -p 54314 -P 54318 -o "-c jit=off" -O "-c jit=off"
echo "pg_upgrade --check exit code: $?"
set -e
rm -rf "$work/data18-default"

step "pg_upgrade --check, then --link, against 18 initdb --no-data-checksums"
"$B18/initdb" -D "$work/data18" -U postgres -A trust --no-data-checksums >/dev/null
"$B18/pg_upgrade" --check -b "$B14" -B "$B18" -d "$work/data14" -D "$work/data18" -U postgres -s "$sock" -p 54314 -P 54318 -o "-c jit=off" -O "-c jit=off"
t=$(now)
"$B18/pg_upgrade" --link -b "$B14" -B "$B18" -d "$work/data14" -D "$work/data18" -U postgres -s "$sock" -p 54314 -P 54318 -o "-c jit=off" -O "-c jit=off"
echo "pg_upgrade --link: $(took "$t")"
cd "$here"

step "what came over to 18"
start "$B18" "$work/data18" 54318
q18 -d shop -Atc "SELECT 'orders rows: ' || count(*) FROM orders"
q18 -d shop -Atc "SELECT 'pg_stats rows for orders: ' || count(*) FROM pg_stats WHERE tablename = 'orders'"
q18 -d shop -Atc "SELECT 'pg_stats_ext rows: ' || count(*) FROM pg_stats_ext"
q18 -d shop -Atc "SELECT 'extended statistics objects: ' || count(*) FROM pg_statistic_ext"
q18 -d shop -Atc "SELECT 'extensions: ' || string_agg(extname || ' ' || extversion, ', ' ORDER BY extname) FROM pg_extension"
q18 -d parts -Atc "SELECT 'metrics relpersistence on 18: ' || relpersistence::text FROM pg_class WHERE relname = 'metrics'"
q18 -Atc "SELECT 'md5 roles on 18: ' || coalesce(string_agg(rolname, ', '), 'none') FROM pg_authid WHERE rolpassword LIKE 'md5%'"
echo "ALTER ROLE with an MD5 password on 18:"
q18 -c "SET password_encryption = 'md5'" -c "ALTER ROLE legacy_app PASSWORD 'sample-only-2'" 2>&1 | sed 's/^/  /'
echo "plan for a city+country filter before ANALYZE:"
q18 -d shop -Atc "EXPLAIN SELECT * FROM customers WHERE city = 'city-1' AND country = 'country-1'" | head -1
t=$(now)
"$B18/vacuumdb" -h "$sock" -p 54318 -U postgres --all --analyze-in-stages --missing-stats-only
echo "vacuumdb --analyze-in-stages --missing-stats-only: $(took "$t")"
q18 -d shop -Atc "SELECT 'pg_stats_ext rows after vacuumdb: ' || count(*) FROM pg_stats_ext"
echo "plan for the same filter after it:"
q18 -d shop -Atc "EXPLAIN SELECT * FROM customers WHERE city = 'city-1' AND country = 'country-1'" | head -1
stop "$B18" "$work/data18"

step "for comparison: pg_dumpall | psql into a fresh 18 cluster"
# --link moved the 14 files into the 18 cluster, so rebuild the 14 data first (not timed).
rm -rf "$work/data14" "$work/data18"
"$B14/initdb" -D "$work/data14" -U postgres -A trust >/dev/null
start "$B14" "$work/data14" 54314
q14 -d postgres -c "CREATE DATABASE shop" >/dev/null
q14 -d shop >/dev/null <<SQL
CREATE TABLE customers (id int PRIMARY KEY, city text NOT NULL, country text NOT NULL);
INSERT INTO customers SELECT g, 'city-' || (g % 500), 'country-' || (g % 50) FROM generate_series(1, 200000) g;
CREATE TABLE orders (id bigint PRIMARY KEY, customer_id int NOT NULL REFERENCES customers, status text NOT NULL,
  amount numeric(10,2) NOT NULL, created_at timestamptz NOT NULL, note text);
INSERT INTO orders SELECT g, 1 + (g % 200000), (ARRAY['new','paid','shipped','done'])[1 + g % 4], (g % 10000) / 100.0,
  timestamptz '2024-01-01' + (g % 31536000) * interval '1 second', md5(g::text) FROM generate_series(1, $rows) g;
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_created_idx ON orders (created_at);
SQL
"$B18/initdb" -D "$work/data18" -U postgres -A trust >/dev/null
start "$B18" "$work/data18" 54318
t=$(now)
# No ON_ERROR_STOP here: the dump recreates the postgres role, which already exists, and that error is harmless.
"$B18/pg_dumpall" -h "$sock" -p 54314 -U postgres | "$B18/psql" -X -q -h "$sock" -p 54318 -U postgres -d postgres >/dev/null 2>"$work/restore.err"
echo "pg_dumpall (18 client) | psql: $(took "$t")"
echo "restore errors: $(grep -c ERROR "$work/restore.err" || true)"
grep ERROR "$work/restore.err" | sed 's/^/  /' || true
q18 -d shop -Atc "SELECT 'orders rows after restore: ' || count(*) FROM orders"
q18 -Atc "SHOW data_checksums" | sed 's/^/18 data_checksums after dump\/restore: /'
