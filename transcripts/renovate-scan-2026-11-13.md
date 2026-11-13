# 20 open Renovate "Update postgres Docker tag to v18" PRs, checked at their head commit

Date: 2026-11-13. Sample: the 20 newest repos with an open PR titled exactly `Update postgres Docker tag to v18`
(GitHub issue search sorted by creation date, patch bumps like `to v18.7` left out, one PR per repo).
Each repo was downloaded at the PR's base and head commits (YAML, Dockerfiles, env files only), committed as two
commits, and checked with `pg18-upgrade-check . --base HEAD~1 --json` (version 78eeb12).

| Repo | PR | Findings |
| --- | --- | --- |
| WyriHaximus/reactphp-simple-orm | [#177](https://github.com/WyriHaximus/reactphp-simple-orm/pull/177) @ `cd0a9b88a4` | none |
| blazepower/rishik-homelab-rke2 | [#433](https://github.com/blazepower/rishik-homelab-rke2/pull/433) @ `ead49a9f68` | none |
| uppertoe/journal-watch-vps | [#11](https://github.com/uppertoe/journal-watch-vps/pull/11) @ `84e65b0f04` | checksums (warning) `apps/journal-watch/docker-compose.yml:150`<br>major-bump (error) `apps/journal-watch/docker-compose.yml:150`<br>checksums (warning) `apps/journal-watch/docker-compose.yml:498`<br>major-bump (error) `apps/journal-watch/docker-compose.yml:498`<br>data-mount (error) `apps/journal-watch/docker-compose.yml:522` |
| kanade0404/tenhou-log | [#963](https://github.com/kanade0404/tenhou-log/pull/963) @ `12dd6600aa` | checksums (warning) `docker-compose.yaml:5`<br>major-bump (error) `docker-compose.yaml:5`<br>checksums (warning) `docker-compose.yaml:19`<br>major-bump (error) `docker-compose.yaml:19` |
| spicyFajitas/cookbooks | [#91](https://github.com/spicyFajitas/cookbooks/pull/91) @ `b1bbf83756` | checksums (warning) `kubernetes/apps/speedtest-tracker/02-postgres.yaml:32`<br>major-bump (error) `kubernetes/apps/speedtest-tracker/02-postgres.yaml:32` |
| Colewiz7/jobscout | [#14](https://github.com/Colewiz7/jobscout/pull/14) @ `662576a1f4` | none |
| ndevenish/meshtrove | [#9](https://github.com/ndevenish/meshtrove/pull/9) @ `cc9fed15d1` | checksums (warning) `docker-compose.prod.yml:13`<br>major-bump (error) `docker-compose.prod.yml:13`<br>data-mount (error) `docker-compose.prod.yml:30`<br>checksums (warning) `docker-compose.yml:3`<br>major-bump (error) `docker-compose.yml:3`<br>data-mount (error) `docker-compose.yml:11` |
| pikatenor/infra | [#331](https://github.com/pikatenor/infra/pull/331) @ `2c4cbe146f` | skipped-image (info) `borg4/default/bounca.yml:77`<br>checksums (warning) `starlight30/chopin/app.yml:43`<br>major-bump (error) `starlight30/chopin/app.yml:43` |
| rock8-cloud/strapi-next-turborepo-starter | [#15](https://github.com/rock8-cloud/strapi-next-turborepo-starter/pull/15) @ `d6463d385b` | checksums (warning) `docker-compose.yml:6`<br>major-bump (error) `docker-compose.yml:6`<br>data-mount (error) `docker-compose.yml:15` |
| teevik/homelab | [#101](https://github.com/teevik/homelab/pull/101) @ `1b45febd89` | checksums (warning) `manifests/homelab/paperless-ngx/Deployment-paperless-db.yaml:29`<br>major-bump (error) `manifests/homelab/paperless-ngx/Deployment-paperless-db.yaml:29`<br>data-mount (error) `manifests/homelab/paperless-ngx/Deployment-paperless-db.yaml:41` |
| rock8-cloud/astro-emdash-marketing-page | [#9](https://github.com/rock8-cloud/astro-emdash-marketing-page/pull/9) @ `69dc8e1a60` | checksums (warning) `docker-compose.yml:9`<br>major-bump (error) `docker-compose.yml:9`<br>data-mount (error) `docker-compose.yml:18` |
| leprechaun/chart-postgres | [#2](https://github.com/leprechaun/chart-postgres/pull/2) @ `8f4a14c758` | data-mount (warning) `helm-charts/postgres/templates/statefulset.yaml:47`<br>checksums (warning) `helm-charts/postgres/values.yaml:8`<br>major-bump (error) `helm-charts/postgres/values.yaml:8` |
| rock8-cloud/medusajs-tanstack-start-blueprint | [#26](https://github.com/rock8-cloud/medusajs-tanstack-start-blueprint/pull/26) @ `e65deae494` | checksums (warning) `docker-compose.yml:3`<br>major-bump (error) `docker-compose.yml:3`<br>data-mount (error) `docker-compose.yml:13` |
| kgtkr/autopush-fcm-bridge | [#11](https://github.com/kgtkr/autopush-fcm-bridge/pull/11) @ `031852bef8` | checksums (warning) `docker-compose.yml:3`<br>major-bump (error) `docker-compose.yml:3`<br>data-mount (error) `docker-compose.yml:11` |
| gsfernandes81/infra | [#20](https://github.com/gsfernandes81/infra/pull/20) @ `984ab4d172` | checksums (warning) `dev/compose.yaml:478`<br>major-bump (error) `dev/compose.yaml:478`<br>data-mount (error) `dev/compose.yaml:496` |
| mrmarkuz/ns8-kitchenowl | [#44](https://github.com/mrmarkuz/ns8-kitchenowl/pull/44) @ `b809296e5e` | none |
| JonasHess/homelab-iac | [#885](https://github.com/JonasHess/homelab-iac/pull/885) @ `d0396e0ec2` | checksums (warning) `apps/postgres/values.yaml:8`<br>major-bump (error) `apps/postgres/values.yaml:8`<br>data-mount (warning) `apps/postgres/values.yaml:35` |
| JustLABv1/justcd | [#151](https://github.com/JustLABv1/justcd/pull/151) @ `edd1c21534` | checksums (warning) `compose.yaml:5`<br>major-bump (error) `compose.yaml:5`<br>data-mount (error) `compose.yaml:12` |
| bsmeding/nautobot_docker_compose_test_environment | [#2](https://github.com/bsmeding/nautobot_docker_compose_test_environment/pull/2) @ `1a7f271dec` | checksums (warning) `docker-compose.yml:56`<br>major-bump (error) `docker-compose.yml:56`<br>data-mount (error) `docker-compose.yml:71` |
| civicband/clerk | [#188](https://github.com/civicband/clerk/pull/188) @ `38f8a18a66` | none |

Totals: major-bump 18, checksums 18, data-mount 13, skipped-image 1

Per repo (20):
- 15 repos, 18 Postgres services: the major goes up (17 → 18: 12, 16 → 18: 4, 15 → 18: 1, 14 → 18: 1) on a persistent
  volume, with no dump or pg_upgrade step next to it (`major-bump`). None of the 18 sets `--data-checksums` or
  `--no-data-checksums` in `POSTGRES_INITDB_ARGS` (`checksums`).
- 12 of those repos, 13 services: the volume is still at /var/lib/postgresql/data and PGDATA is not set, so the 18
  entrypoint exits (`data-mount`; 2 of the 13 are Helm charts, reported as warnings).
- The other 5 bumped services set PGDATA themselves (4 to /var/lib/postgresql/data/pgdata, 1 to /var/lib/postgresql/data).
  They get past the entrypoint check and then meet the old major's data files.
- 5 repos had nothing to report: 3 bump only a GitHub Actions service container, 1 a test database with no volume,
  and 1 changes an image name inside a shell script, which the tool does not read.

Two misses in the first pass, fixed before these numbers (commits b3c74c9, 78eeb12): a Helm chart that mounts the old
path in `templates/statefulset.yaml`, and a Deployment that runs Postgres as a native sidecar (an `initContainers`
entry with `restartPolicy: Always`).

Note: "base" is the tip of the PR's base branch on 2026-11-13, so a diff can include unrelated changes; only the
Postgres image lines were compared.
