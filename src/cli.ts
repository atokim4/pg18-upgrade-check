#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { counts, formatJson, formatText } from './report.js';
import { scan } from './scan.js';

export const EXIT = { ok: 0, findings: 1, usage: 2 } as const;

const HELP = `Usage: pg18-upgrade-check [path] [options]

Checks docker compose files, Kubernetes manifests, Helm values, GitHub Actions
service containers and Dockerfiles for Postgres 18 upgrade traps. Offline; no Docker needed.

Arguments:
  path                 repository directory or a single file (default: .)

Options:
  --base <git-ref>     compare with this ref (e.g. origin/main) to catch major bumps,
                       the way a Renovate "postgres to v18" PR makes them
  --from <major>       assume every container ran this major before (no git needed)
  --json               machine-readable output
  --strict             exit 1 on warnings too, not only errors
  --verbose            also print info findings (skipped images)
  --no-color           plain text output
  -h, --help           show this help
  -v, --version        print the version

Exit codes: 0 no problems, 1 problems found, 2 bad usage or unreadable path.`;

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
  isTTY: boolean;
}

export function run(argv: string[], io: CliIO): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        base: { type: 'string' },
        from: { type: 'string' },
        json: { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        verbose: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (e) {
    io.err(`${(e as Error).message}\n\n${HELP}`);
    return EXIT.usage;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(HELP);
    return EXIT.ok;
  }
  if (values.version) {
    io.out('0.1.0');
    return EXIT.ok;
  }
  if (positionals.length > 1) {
    io.err(`Expected one path, got ${positionals.length}.\n\n${HELP}`);
    return EXIT.usage;
  }
  let fromMajor: number | undefined;
  if (values.from !== undefined) {
    fromMajor = Number(values.from);
    if (!Number.isInteger(fromMajor) || fromMajor < 9 || fromMajor > 30) {
      io.err(`--from must be a Postgres major like 14, got "${values.from}".`);
      return EXIT.usage;
    }
  }
  if (values.base !== undefined && fromMajor !== undefined) {
    io.err('Use either --base or --from, not both.');
    return EXIT.usage;
  }

  const path = positionals[0] ?? '.';
  let result;
  try {
    result = scan(path, { ...(values.base === undefined ? {} : { base: values.base }), ...(fromMajor === undefined ? {} : { fromMajor }) });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const why = err.code === 'ENOENT' ? `no such file or directory: ${path}`
      : values.base !== undefined && /git/.test(err.message) ? `cannot read git ref "${values.base}" in ${path}`
      : err.message;
    io.err(`pg18-upgrade-check: ${why}`);
    return EXIT.usage;
  }

  io.out(values.json ? formatJson(result) : formatText(result, { color: io.isTTY && !values['no-color'] && !process.env.NO_COLOR, showInfo: values.verbose }));
  const c = counts(result.findings);
  return c.error > 0 || (values.strict && c.warning > 0) ? EXIT.findings : EXIT.ok;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exitCode = run(process.argv.slice(2), {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    isTTY: process.stdout.isTTY,
  });
}
