#!/usr/bin/env bash
# Runs the data-directory checks from the official postgres:18 image entrypoint without Docker.
#
# It downloads docker-entrypoint.sh at a pinned commit of docker-library/postgres, remaps
# /var/lib/postgresql into a temp dir, fakes /proc/self/mountinfo so that a "mount" exists
# at the old path, then calls the entrypoint's own docker_setup_env + docker_error_old_databases.
#
# Usage: scripts/entrypoint-sim.sh [--old-data] [PGDATA]
#   --old-data  put a PG_VERSION file (14) in the mounted /var/lib/postgresql/data first
#   PGDATA      container path to use as PGDATA (default: the image default, /var/lib/postgresql/18/docker)
set -euo pipefail

old_data=false
if [ "${1:-}" = "--old-data" ]; then old_data=true; shift; fi
container_pgdata="${1:-/var/lib/postgresql/18/docker}"

commit=dfc76bb299b057785026eb2eea39556b6fe52983
url="https://raw.githubusercontent.com/docker-library/postgres/$commit/18/trixie/docker-entrypoint.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL "$url" -o "$work/entrypoint.orig.sh"
root="$work/root"
mkdir -p "$root/var/lib/postgresql/data"
if $old_data; then echo 14 > "$root/var/lib/postgresql/data/PG_VERSION"; fi
printf '36 35 0:40 / %s rw - ext4 /dev/vda rw\n' "$root/var/lib/postgresql/data" > "$work/mountinfo"

sed -e "s#/var/lib/postgresql#$root/var/lib/postgresql#g" \
    -e "s#/proc/self/mountinfo#$work/mountinfo#g" \
    "$work/entrypoint.orig.sh" > "$work/entrypoint.sh"

export PG_MAJOR=18
export PGDATA="$root$container_pgdata"
export POSTGRES_PASSWORD=sample

# shellcheck disable=SC1091
source "$work/entrypoint.sh"
docker_setup_env
echo "PGDATA=$container_pgdata, mount at /var/lib/postgresql/data, old data in it: $old_data"
if [ -n "$DATABASE_ALREADY_EXISTS" ]; then
	echo "entrypoint: PG_VERSION found in PGDATA, skips initdb and starts postgres on the existing files"
	exit 0
fi
docker_error_old_databases
echo "entrypoint checks passed: initdb would run in $container_pgdata"
