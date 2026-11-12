import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuleId, Severity } from '../src/model.js';
import { scan } from '../src/scan.js';

const fixture = (name: string): string => join(import.meta.dirname, 'fixtures', name);

function rules(path: string, opts = {}): Array<[RuleId, Severity, number]> {
  return scan(path, opts).findings.map((f) => [f.rule, f.severity, f.line]);
}

describe('data-mount: something mounted at /var/lib/postgresql/data on an 18 image', () => {
  it('compose named volume', () => {
    expect(rules(fixture('compose-old-mount'))).toEqual([['data-mount', 'error', 7]]);
  });

  it('compose image from .env interpolation, env_file without PGDATA', () => {
    // The .env files are written here, not committed, so the repo holds no dotenv files.
    const dir = mkdtempSync(join(tmpdir(), 'pg18-env-'));
    try {
      cpSync(fixture('compose-env'), dir, { recursive: true });
      writeFileSync(join(dir, '.env'), 'POSTGRES_VERSION=18\n');
      writeFileSync(join(dir, '.env.db'), 'POSTGRES_DB=app\n');
      expect(rules(dir)).toEqual([['data-mount', 'error', 6]]);
      expect(rules(fixture('compose-env'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compose build: reads FROM in the Dockerfile', () => {
    const result = scan(fixture('compose-build'));
    expect(result.targets.map((t) => [t.kind, t.image.raw])).toEqual([
      ['dockerfile', 'postgis/postgis:18-3.6'],
      ['compose', 'postgis/postgis:18-3.6'],
    ]);
    expect(rules(fixture('compose-build'))).toEqual([['data-mount', 'error', 8]]);
  });

  it('GitHub Actions service with --tmpfs on the old path', () => {
    expect(rules(fixture('actions-tmpfs'))).toEqual([['data-mount', 'error', 11]]);
  });

  it('Kubernetes StatefulSet with a volumeClaimTemplate', () => {
    expect(rules(fixture('k8s-statefulset'))).toEqual([['data-mount', 'error', 25]]);
  });

  it('downgrades to a warning when PGDATA could come from envFrom', () => {
    expect(rules(fixture('k8s-envfrom'))).toEqual([['data-mount', 'warning', 19]]);
  });

  it('Dockerfile VOLUME on the old path', () => {
    expect(rules(fixture('dockerfile-volume'))).toEqual([['data-mount', 'error', 3]]);
  });

  it('Helm values are a hint only', () => {
    expect(rules(fixture('helm-values'))).toEqual([['data-mount', 'warning', 8]]);
  });
});

describe('no false positives', () => {
  it('PGDATA pinned to the old path', () => {
    expect(rules(fixture('compose-pinned-pgdata'))).toEqual([]);
  });

  it('volume at /var/lib/postgresql (the 18 layout)', () => {
    expect(rules(fixture('compose-new-layout'))).toEqual([]);
  });

  it('fresh CI service container with no mounts, even with --from 14', () => {
    expect(rules(fixture('actions-ephemeral'))).toEqual([]);
    expect(rules(fixture('actions-ephemeral'), { fromMajor: 14 })).toEqual([]);
  });

  it('init script and backup bind mounts are not data volumes, even with --from 16', () => {
    expect(rules(fixture('compose-init-script'))).toEqual([]);
    expect(rules(fixture('compose-init-script'), { fromMajor: 16 })).toEqual([]);
  });

  it('pgvector on 18 with the new layout, timescale still on 17', () => {
    expect(rules(fixture('extension-images'))).toEqual([]);
  });

  it('images with their own layout are reported as skipped info only', () => {
    expect(rules(fixture('other-layout'))).toEqual([['skipped-image', 'info', 3]]);
  });
});

describe('floating-tag', () => {
  it('postgres with no tag and a persistent volume', () => {
    expect(rules(fixture('floating-latest'))).toEqual([['floating-tag', 'warning', 3]]);
  });
});

describe('major bump against a git base (the Renovate PR case)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function repo(before: string, after: string): string {
    dir = mkdtempSync(join(tmpdir(), 'pg18-check-'));
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    };
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, 'docker-compose.yml'), before);
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    writeFileSync(join(dir, 'docker-compose.yml'), after);
    return dir;
  }

  const compose = (image: string, extra = ''): string =>
    `services:\n  db:\n    image: ${image}\n    environment:\n      PGDATA: /var/lib/postgresql/data\n${extra}    volumes:\n      - pgdata:/var/lib/postgresql/data\nvolumes:\n  pgdata:\n`;

  it('14 -> 18 on a named volume with PGDATA pinned: bump and checksums', () => {
    const d = repo(compose('postgres:14'), compose('postgres:18'));
    expect(rules(d, { base: 'HEAD' })).toEqual([
      ['major-bump', 'error', 3],
      ['checksums', 'warning', 3],
    ]);
  });

  it('no checksum warning when POSTGRES_INITDB_ARGS chooses explicitly', () => {
    const args = '      POSTGRES_INITDB_ARGS: --no-data-checksums\n';
    const before = compose('postgres:14').replace('    volumes:', `${args}    volumes:`);
    const after = compose('postgres:18').replace('    volumes:', `${args}    volumes:`);
    expect(rules(repo(before, after), { base: 'HEAD' })).toEqual([['major-bump', 'error', 3]]);
  });

  it('a pgautoupgrade service counts as the upgrade step', () => {
    const helper = '  upgrade:\n    image: pgautoupgrade/pgautoupgrade:18-alpine\n';
    const before = compose('postgres:14');
    const after = compose('postgres:18').replace('volumes:\n  pgdata:', `${helper}volumes:\n  pgdata:`);
    expect(rules(repo(before, after), { base: 'HEAD' }).map(([r]) => r)).toEqual(['checksums']);
  });

  it('same major on both sides is not a bump', () => {
    expect(rules(repo(compose('postgres:18.0'), compose('postgres:18.1')), { base: 'HEAD' })).toEqual([]);
  });

  it('a bad ref throws', () => {
    const d = repo(compose('postgres:14'), compose('postgres:18'));
    expect(() => scan(d, { base: 'no-such-ref' })).toThrow();
  });
});
