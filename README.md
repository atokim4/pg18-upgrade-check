# pg18-upgrade-check

An offline preflight for moving Postgres in Docker, Kubernetes or CI to version 18.
Point it at a repository and it tells you, file and line, which Postgres containers will
break when the image tag becomes `18`, and what to change.

It also ships `sql/preflight.sql`, a read-only report to run on the old cluster before
`pg_upgrade`, and the scripts used to test a full 14 → 18 upgrade without root or Docker.

```
$ pg18-upgrade-check .
Scanned 1 file: 1 Postgres container, 1 on 18+.

ERROR  docker-compose.yml:7  db (postgres:18-alpine)  [data-mount]
  postgres:18-alpine keeps its data in /var/lib/postgresql/18/docker, but a named volume is mounted at /var/lib/postgresql/data. On a first start the entrypoint sees that mount and exits before initdb ("Error: in 18+, these Docker images are configured to store database data in a format which is compatible with pg_ctlcluster ...").
  Fix:
    1. keep the old layout: add `PGDATA: /var/lib/postgresql/data` under `environment:` and keep the mount as it is
    2. or use the 18 layout: mount the volume at /var/lib/postgresql instead of /var/lib/postgresql/data; data already in the volume has to be dumped and restored, or pg_upgraded, first

1 error, 0 warnings.
```

## Why

Two things changed in Postgres 18 that a one-line tag bump does not handle:

- **The official image moved its data directory.** From 18 on, the docker-library `postgres`
  image sets `PGDATA=/var/lib/postgresql/18/docker` and declares `VOLUME /var/lib/postgresql`
  ([docker-library/postgres#1259](https://github.com/docker-library/postgres/pull/1259)).
  A volume still mounted at `/var/lib/postgresql/data` makes the entrypoint print a long
  "in 18+, these Docker images are configured to store database data in a format which is
  compatible with pg_ctlcluster" error and exit, even when that volume is empty.
  `scripts/entrypoint-sim.sh` runs the real entrypoint's checks to show it.
- **A new major cannot open the old major's files.** Starting 18 on a volume written by 14-17
  fails with `database files are incompatible with server`. You need a dump/restore or
  `pg_upgrade`, and `pg_upgrade` to 18 has its own catch: `initdb` now enables data checksums
  by default, so a default 14 cluster fails `--check` with
  `old cluster does not use data checksums but the new one does`.

## What it checks

| Rule | Severity | When |
| --- | --- | --- |
| `data-mount` | error | an 18+ official-layout image has a mount at `/var/lib/postgresql/data` and no `PGDATA` pinning it there |
| `major-bump` | error | `--base`/`--from` shows the major went up on a persistent data volume, with no upgrade step next to it (`pgautoupgrade`, `tianon/postgres-upgrade`, `pg_upgrade`); a dump step only lowers it to a warning |
| `checksums` | warning | a bump that will go through `pg_upgrade` and no explicit `--data-checksums`/`--no-data-checksums` in `POSTGRES_INITDB_ARGS` |
| `floating-tag` | warning | `postgres`, `postgres:latest`, `postgres:alpine`... on a persistent volume: the next pull is 19 (`latest` moved to 19 on 2026-11-20) |
| `pgdata-not-persisted` | warning | `PGDATA` is outside every data mount, so the data lands in an anonymous volume |
| `skipped-image` | info | images with their own layout (bitnami, timescaledb-ha, supabase/postgres, CloudNativePG) |

Sources it reads: `docker-compose*.yml` / `compose*.yaml` (with `.env` interpolation, `env_file`
and `build:` Dockerfiles), Kubernetes manifests (Deployments, StatefulSets with
`volumeClaimTemplates`, `envFrom`, native sidecars in `initContainers`), Helm `values*.yaml` (plus the chart's `templates/`, read as
text for `mountPath` and `PGDATA` because Go templates are not YAML), GitHub Actions `services:`,
and Dockerfiles. Images it understands: `postgres`, `postgis/postgis`, `pgvector/pgvector`,
`timescale/timescaledb`, from any registry, with or without digests.

Things it stays quiet about on purpose:

- CI service containers. They start empty on every run, so a bump there is fine.
- Bind mounts of init scripts, config files and backup folders.
- `PGDATA` pinned to `/var/lib/postgresql/data` with the mount kept there (the old layout still works on 18).
- A mount at `/var/lib/postgresql` (the 18 layout).

When `PGDATA` may come from somewhere it cannot read (a missing `env_file`, `envFrom`, chart
templates), errors are downgraded to warnings and the message says so. A gitignored `env_file`
with a committed template next to it (`.env.example`, `.env.sample`, `env.example`...) is read
from the template instead, and the message names the template it used.

A YAML file that does not parse is listed as `SKIP` with the line of the syntax error (and under
`unreadable` in `--json`), so a service in it is never skipped without a word. If Compose itself
loads the file, `docker compose -f <file> config > compose.rendered.yml` writes a normalised copy
the tool can read.

## Usage

Needs Node.js 22 or newer.

```sh
git clone https://github.com/atokim4/pg18-upgrade-check
cd pg18-upgrade-check
npm ci && npm run build
node dist/src/cli.js /path/to/repo
```

```
pg18-upgrade-check [path] [options]

  path                 repository directory or a single file (default: .)
  --base <git-ref>     compare with this ref (e.g. origin/main) to catch major bumps,
                       the way a Renovate "postgres to v18" PR makes them
  --from <major>       assume every container ran this major before (no git needed)
  --json               machine-readable output
  --strict             exit 1 on warnings and unreadable YAML files too, not only errors
  --verbose            also print info findings (skipped images)
  --no-color           plain text output
```

Exit codes: `0` no problems, `1` problems found, `2` bad usage or unreadable path.

### On a Renovate PR in CI

```yaml
# .github/workflows/pg18-check.yml
on: pull_request
jobs:
  pg18:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: |
          git clone --depth 1 https://github.com/atokim4/pg18-upgrade-check /tmp/pg18
          (cd /tmp/pg18 && npm ci && npm run build)
          node /tmp/pg18/dist/src/cli.js . --base origin/${{ github.base_ref }}
```

## sql/preflight.sql

Read-only checks for the old cluster (12-17). Every statement is a `SELECT` or `SHOW` and the
session is set to read-only.

```sh
psql -X -d <database> -f sql/preflight.sql
```

| Section | What it lists |
| --- | --- |
| 1 | server version and `data_checksums` (decides `--no-data-checksums` for the new initdb) |
| 2, 3 | roles with MD5 password hashes and `pg_hba.conf` lines using `md5` (deprecated in 18) |
| 4 | extended statistics; `pg_upgrade` 18 keeps column statistics but not these, so it prints the `ANALYZE` to run after |
| 5 | installed extensions and versions, to install for 18 first |
| 6 | user columns of `reg*` types that `pg_upgrade` refuses |
| 7 | unlogged partitioned tables (18 no longer allows creating them) |
| 8 | inheritance parents (in 18, `VACUUM`/`ANALYZE` on the parent also process the children) |
| 9 | database sizes |
| 10 | databases with a non-libc collation provider (reindex FTS and `pg_trgm` indexes after `pg_upgrade`) |

## The 14 → 18 test

`scripts/pgdg-fetch.sh` unpacks the PGDG `postgresql-14` and `postgresql-18` packages into a
directory without root. `scripts/upgrade-repro.sh` then builds a ~1.8 GB sample database on 14,
runs `preflight.sql`, tries `pg_upgrade --check` against a default 18 initdb, runs
`pg_upgrade --link` against an 18 initdb with `--no-data-checksums`, checks what came over, and
times a `pg_dumpall | psql` copy for comparison.

```sh
scripts/pgdg-fetch.sh /tmp/pgbin 14 18
scripts/upgrade-repro.sh /tmp/pgbin /tmp/pgwork | tee transcript.txt
```

The servers run with `jit=off` because the fetch script leaves out the LLVM library.
`transcripts/14-to-18.txt` is one full run (14.24 → 18.6, 12 million sample rows, 2 vCPUs).
`transcripts/17-data-on-18.txt` shows an 18.7 server refusing a 17 data directory,
`transcripts/18-data-on-19.txt` shows the postgres:19 entrypoint stopping on a volume that holds an 18 cluster, and
`transcripts/renovate-scan-2026-11-13.md` is the tool run on 20 open Renovate "postgres to v18" PRs.

## Development

```sh
npm ci
npm test          # vitest, fixtures in test/fixtures
npm run lint
npm run typecheck
npm run check -- test/fixtures/compose-old-mount   # run from source with tsx
```

## Licence

MIT, see [LICENSE](LICENSE). Written by Sunnatulla E.
