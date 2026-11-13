import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { EXIT, run } from '../src/cli.js';

const fixture = (name: string): string => join(import.meta.dirname, 'fixtures', name);

function cli(...args: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(args, { out: (s) => (out += s), err: (s) => (err += s), isTTY: false });
  return { code, out, err };
}

describe('cli', () => {
  it('exits 1 with an error finding and prints the fix', () => {
    const r = cli(fixture('compose-old-mount'));
    expect(r.code).toBe(EXIT.findings);
    expect(r.out).toContain('docker-compose.yml:7');
    expect(r.out).toContain('PGDATA: /var/lib/postgresql/data');
  });

  it('exits 0 for a clean setup', () => {
    expect(cli(fixture('compose-new-layout')).code).toBe(EXIT.ok);
  });

  it('warnings pass by default and fail with --strict', () => {
    expect(cli(fixture('floating-latest')).code).toBe(EXIT.ok);
    expect(cli(fixture('floating-latest'), '--strict').code).toBe(EXIT.findings);
  });

  it('--json is parseable and carries the findings', () => {
    const r = cli(fixture('k8s-statefulset'), '--json');
    const parsed = JSON.parse(r.out) as { summary: { error: number }; findings: Array<{ rule: string }> };
    expect(parsed.summary.error).toBe(1);
    expect(parsed.findings[0]?.rule).toBe('data-mount');
  });

  it('names a file it could not parse; --strict fails on it', () => {
    const r = cli(fixture('compose-bad-yaml'));
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain('SKIP   docker-compose.yml:6  not valid YAML');
    expect(r.out).toContain('1 file could not be read.');
    expect(cli(fixture('compose-bad-yaml'), '--strict').code).toBe(EXIT.findings);
    const json = JSON.parse(cli(fixture('compose-bad-yaml'), '--json').out) as { unreadable: Array<{ file: string }> };
    expect(json.unreadable.map((u) => u.file)).toEqual(['docker-compose.yml']);
  });

  it('usage errors exit 2', () => {
    expect(cli('--from', 'abc').code).toBe(EXIT.usage);
    expect(cli('--nope').code).toBe(EXIT.usage);
    expect(cli('/no/such/path').code).toBe(EXIT.usage);
    expect(cli('--base', 'x', '--from', '14').code).toBe(EXIT.usage);
  });
});
