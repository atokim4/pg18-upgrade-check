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

  it('Kubernetes native sidecar (initContainer with restartPolicy: Always); a plain init container is not a database', () => {
    const result = scan(fixture('k8s-sidecar'));
    expect(result.targets.map((t) => t.name)).toEqual(['Deployment/app/postgres']);
    expect(result.findings.map((f) => [f.rule, f.severity, f.line])).toEqual([['data-mount', 'error', 16]]);
  });

  it('Helm values are a hint only', () => {
    expect(rules(fixture('helm-values'))).toEqual([['data-mount', 'warning', 8]]);
  });

  it('Helm chart whose template mounts the old path (templates read as text)', () => {
    const result = scan(fixture('helm-chart-template'));
    expect(result.findings.map((f) => [f.rule, f.severity, f.file, f.line])).toEqual([
      ['data-mount', 'warning', 'templates/statefulset.yaml', 14],
    ]);
    expect(result.findings[0]?.message).toContain('chart template templates/statefulset.yaml');
    expect(result.unreadable).toEqual([]);
    expect(result.helmTemplates).toBe(1);
  });
});

describe('no false positives', () => {
  it('Helm chart template that sets PGDATA', () => {
    expect(rules(fixture('helm-chart-template-pgdata'))).toEqual([]);
  });

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

  const compose18Layout = (image: string): string =>
    `services:\n  db:\n    image: ${image}\n    volumes:\n      - pgdata:/var/lib/postgresql\nvolumes:\n  pgdata:\n`;

  it('18 -> 19 on the 18+ layout: bump names the entrypoint exit, no checksum warning', () => {
    const d = repo(compose18Layout('postgres:18'), compose18Layout('postgres:19'));
    const found = scan(d, { base: 'HEAD' }).findings;
    expect(found.map((f) => [f.rule, f.severity])).toEqual([['major-bump', 'error']]);
    expect(found[0]?.message).toContain('finds the 18 cluster in /var/lib/postgresql/18/docker and exits before initdb');
    expect(found[0]?.message).not.toContain('FATAL');
    expect(found[0]?.fix[0]).toContain('start the 19 image on a new, empty volume');
  });

  it('18 -> 19 with PGDATA pinned to the old path: the server FATAL, no checksum warning', () => {
    const found = scan(repo(compose('postgres:18'), compose('postgres:19')), { base: 'HEAD' }).findings;
    expect(found.map((f) => f.rule)).toEqual(['major-bump']);
    expect(found[0]?.message).toContain('database files are incompatible with server');
  });

  it('17 -> 19 still warns about checksums and names 19 in the fix', () => {
    const found = scan(repo(compose('postgres:17'), compose('postgres:19')), { base: 'HEAD' }).findings;
    expect(found.map((f) => f.rule)).toEqual(['major-bump', 'checksums']);
    expect(found[1]?.fix[1]).toContain('create the 19 cluster');
  });

  it('same major on both sides is not a bump', () => {
    expect(rules(repo(compose('postgres:18.0'), compose('postgres:18.1')), { base: 'HEAD' })).toEqual([]);
  });

  it('a bad ref throws', () => {
    const d = repo(compose('postgres:14'), compose('postgres:18'));
    expect(() => scan(d, { base: 'no-such-ref' })).toThrow();
  });
});

describe('env_file that is not in the repo', () => {
  function withTemplate(template: string | null, fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'pg18-tpl-'));
    try {
      cpSync(fixture('compose-env-template'), dir, { recursive: true });
      if (template !== null) writeFileSync(join(dir, '.env.example'), template);
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('without a template: a warning that names the missing file; PGDATA in environment: wins and is clean', () => {
    withTemplate(null, (dir) => {
      const result = scan(dir);
      expect(result.findings.map((f) => [f.rule, f.severity, f.target])).toEqual([['data-mount', 'warning', 'db']]);
      expect(result.findings[0]?.message).toContain('PGDATA may be set in .env, which is not in the repo');
    });
  });

  it('reads the committed .env.example in its place', () => {
    withTemplate('POSTGRES_USER=app\n', (dir) => {
      const result = scan(dir);
      expect(result.findings.map((f) => [f.rule, f.severity, f.target])).toEqual([['data-mount', 'error', 'db']]);
      expect(result.findings[0]?.message).toContain('env_file read from .env.example');
    });
  });

  it('a template that pins PGDATA keeps the old layout working', () => {
    withTemplate('PGDATA=/var/lib/postgresql/data\n', (dir) => {
      expect(scan(dir).findings).toEqual([]);
    });
  });
});

describe('files that are not valid YAML', () => {
  it('are listed as unreadable instead of being skipped silently', () => {
    const result = scan(fixture('compose-bad-yaml'));
    expect(result.targets).toEqual([]);
    expect(result.unreadable.map((u) => [u.file, u.line])).toEqual([['docker-compose.yml', 6]]);
    expect(result.unreadable[0]?.message).toContain("Missing closing 'quote");
  });

  it('valid files report nothing unreadable', () => {
    expect(scan(fixture('compose-old-mount')).unreadable).toEqual([]);
  });
});
