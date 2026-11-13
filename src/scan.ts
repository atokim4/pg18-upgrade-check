import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix, relative, resolve, sep } from 'node:path';
import type { FileProblem, PostgresTarget, ScanResult, SourceKind } from './model.js';
import { evaluate } from './rules.js';
import { actionsTargets } from './sources/actions.js';
import { composeTargets } from './sources/compose.js';
import { dockerfileTargets } from './sources/dockerfile.js';
import { applyTemplateMounts, helmTargets, isHelmTemplate, type ChartTemplate } from './sources/helm.js';
import { kubernetesTargets, looksLikeKubernetes } from './sources/kubernetes.js';
import { firstYamlError, type Snapshot } from './sources/util.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', 'target', '.terraform']);
const MAX_FILE_BYTES = 1024 * 1024;

export interface ScanOptions {
  /** Git ref to compare against (e.g. `origin/main`): finds major bumps the way a Renovate PR makes them. */
  base?: string;
  /** Assume every container ran this major before, when there is no git history to compare. */
  fromMajor?: number;
}

export function classify(relPath: string, text: () => string): SourceKind | null {
  const name = basename(relPath).toLowerCase();
  const posixPath = relPath.split(sep).join('/');
  if (/^(docker-)?compose([.-][\w.-]+)?\.ya?ml$/.test(name)) return 'compose';
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(posixPath)) return 'github-actions';
  if (name === 'dockerfile' || name.endsWith('.dockerfile') || /^dockerfile[.-]/.test(name) || name === 'containerfile') return 'dockerfile';
  if (/^values([.-][\w.-]+)?\.ya?ml$/.test(name)) return 'helm-values';
  if (/\.ya?ml$/.test(name)) {
    const t = text();
    if (t.length <= MAX_FILE_BYTES && looksLikeKubernetes(t)) return 'kubernetes';
  }
  return null;
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
    }
  }
}

function fsSnapshot(root: string): Snapshot {
  return {
    read(rel) {
      try {
        const p = join(root, rel);
        if (statSync(p).size > MAX_FILE_BYTES) return null;
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
  };
}

function gitSnapshot(root: string, ref: string): Snapshot {
  const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' });
  return {
    read(rel) {
      try {
        return execFileSync('git', ['show', `${ref}:${prefix}${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_FILE_BYTES });
      } catch {
        return null;
      }
    },
  };
}

function targetsFor(kind: SourceKind, file: string, text: string, snap: Snapshot): PostgresTarget[] {
  switch (kind) {
    case 'compose':
      return composeTargets(file, text, snap);
    case 'github-actions':
      return actionsTargets(file, text);
    case 'dockerfile':
      return dockerfileTargets(file, text);
    case 'helm-values':
      return helmTargets(file, text);
    case 'kubernetes':
      return kubernetesTargets(file, text);
  }
}

/** Scans a directory, or a single file, for Postgres containers and checks each one. */
export function scan(path: string, options: ScanOptions = {}): ScanResult {
  const abs = resolve(path);
  const isDir = statSync(abs).isDirectory();
  const root = isDir ? abs : resolve(abs, '..');
  const files: string[] = [];
  if (isDir) walk(root, root, files);
  else files.push(basename(abs));
  files.sort();

  const current = fsSnapshot(root);
  const base = options.base === undefined ? null : gitSnapshot(root, options.base);

  const targets: PostgresTarget[] = [];
  const unreadable: FileProblem[] = [];
  const templates = new Map<string, ChartTemplate[]>();
  let filesScanned = 0;
  for (const file of files) {
    let cached: string | null | undefined;
    const text = (): string => (cached ??= current.read(file)) ?? '';
    const kind = classify(file, text);
    if (!kind) continue;
    if (text() === '') continue;
    filesScanned++;
    if (isHelmTemplate(file, text())) {
      const chartDir = file.replace(/(^|\/)templates\/.*$/, '');
      templates.set(chartDir, [...(templates.get(chartDir) ?? []), { file, text: text() }]);
      continue;
    }
    if (kind !== 'dockerfile') {
      const err = firstYamlError(text());
      if (err) unreadable.push({ file, ...err });
    }
    const found = targetsFor(kind, file, text(), current);
    if (base) {
      const oldText = base.read(file);
      const before = oldText === null ? [] : targetsFor(kind, file, oldText, base);
      for (const t of found) {
        const prev = before.find((b) => b.name === t.name);
        t.previousMajor = prev?.image.major ?? null;
      }
    } else if (options.fromMajor !== undefined) {
      for (const t of found) t.previousMajor = options.fromMajor;
    }
    targets.push(...found);
  }

  for (const t of targets) {
    if (t.kind !== 'helm-values') continue;
    const chartTemplates = templates.get(posix.dirname(t.file) === '.' ? '' : posix.dirname(t.file));
    if (chartTemplates) applyTemplateMounts(t, chartTemplates);
  }

  const helmTemplates = [...templates.values()].reduce((n, list) => n + list.length, 0);
  const findings = targets.flatMap(evaluate);
  return { root, filesScanned, unreadable, helmTemplates, targets, findings };
}
