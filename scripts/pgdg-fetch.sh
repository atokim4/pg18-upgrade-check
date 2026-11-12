#!/usr/bin/env bash
# Unpacks PostgreSQL server + client binaries from the PGDG apt repo (Debian bookworm, amd64)
# into a directory, without root and without installing anything system-wide.
#
# Usage: scripts/pgdg-fetch.sh <dest-dir> <major> [<major> ...]
#   e.g. scripts/pgdg-fetch.sh /tmp/pg18-bin 14 18
# Result: <dest-dir>/usr/lib/postgresql/<major>/bin/{initdb,pg_ctl,postgres,pg_upgrade,psql,...}
# Run binaries with LD_LIBRARY_PATH=<dest-dir>/usr/lib/x86_64-linux-gnu so they find this libpq.
set -euo pipefail

if [ $# -lt 2 ]; then
	echo "usage: $0 <dest-dir> <major> [<major> ...]" >&2
	exit 2
fi
dest=$1; shift
repo=https://apt.postgresql.org/pub/repos/apt
mkdir -p "$dest/.debs"
index="$dest/.debs/Packages"

if [ ! -s "$index" ]; then
	curl -fsSL "$repo/dists/bookworm-pgdg/main/binary-amd64/Packages.bz2" | bzip2 -d > "$index"
fi

# Prints the pool path of the newest version of a package (the index lists newest first).
pool_path() {
	awk -v p="$1" '$1=="Package:"{hit=($2==p)} hit&&$1=="Filename:"{print $2; exit}' "$index"
}

packages=(libpq5 postgresql-client-common postgresql-common)
for major in "$@"; do
	packages+=("postgresql-$major" "postgresql-client-$major")
done

for pkg in "${packages[@]}"; do
	path=$(pool_path "$pkg")
	if [ -z "$path" ]; then
		echo "not in the PGDG index: $pkg" >&2
		exit 1
	fi
	deb="$dest/.debs/$(basename "$path")"
	[ -s "$deb" ] || curl -fsSL "$repo/$path" -o "$deb"
	dpkg -x "$deb" "$dest"
	echo "unpacked $(basename "$path")"
done

# PG 18 links liburing for io_method=io_uring; bookworm images often lack it. (The JIT module
# needs libLLVM too; it is left out, so start servers with -c jit=off.)
if ! ldconfig -p 2>/dev/null | grep -q 'liburing.so.2'; then
	deb="$dest/.debs/liburing2_2.3-3_amd64.deb"
	[ -s "$deb" ] || curl -fsSL "https://deb.debian.org/debian/pool/main/libu/liburing/liburing2_2.3-3_amd64.deb" -o "$deb"
	dpkg -x "$deb" "$dest"
	echo "unpacked liburing2_2.3-3_amd64.deb"
fi
