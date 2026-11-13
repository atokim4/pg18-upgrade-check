import type { Finding, ScanResult, Severity } from './model.js';

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
}

export function counts(findings: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function formatText(result: ScanResult, opts: { color: boolean; showInfo: boolean }): string {
  const paint = (code: string, s: string): string => (opts.color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const label: Record<Severity, string> = {
    error: paint('31;1', 'ERROR  '),
    warning: paint('33;1', 'WARN   '),
    info: paint('36', 'INFO   '),
  };
  const lines: string[] = [];
  const pg18 = result.targets.filter((t) => t.image.major !== null && t.image.major >= 18 && t.image.layout === 'official').length;
  const tpl = result.helmTemplates > 0 ? ` ${plural(result.helmTemplates, 'Helm template')} read as text for mounts.` : '';
  lines.push(`Scanned ${plural(result.filesScanned, 'file')}: ${plural(result.targets.length, 'Postgres container')}, ${pg18} on 18+.${tpl}`);

  for (const u of result.unreadable) {
    lines.push('');
    lines.push(`${paint('33;1', 'SKIP   ')}${u.file}:${u.line}  not valid YAML: ${u.message}`);
    lines.push('  Postgres services in it were not checked. If Compose itself loads the file,');
    lines.push('  `docker compose -f <file> config > compose.rendered.yml` writes a normalised copy this tool can read.');
  }

  const shown = sortFindings(result.findings).filter((f) => opts.showInfo || f.severity !== 'info');
  for (const f of shown) {
    lines.push('');
    lines.push(`${label[f.severity]}${f.file}:${f.line}  ${f.target} (${f.image})  [${f.rule}]`);
    lines.push(`  ${f.message}`);
    if (f.fix.length > 0) {
      lines.push('  Fix:');
      f.fix.forEach((step, i) => lines.push(`    ${i + 1}. ${step}`));
    }
  }
  const c = counts(result.findings);
  lines.push('');
  const skipped = result.unreadable.length > 0 ? ` ${plural(result.unreadable.length, 'file')} could not be read.` : '';
  if (c.error === 0 && c.warning === 0) lines.push(paint('32', 'No Postgres 18 data-directory problems found.') + skipped);
  else lines.push(`${plural(c.error, 'error')}, ${plural(c.warning, 'warning')}.${skipped}`);
  return lines.join('\n');
}

export function formatJson(result: ScanResult): string {
  return JSON.stringify(
    {
      root: result.root,
      filesScanned: result.filesScanned,
      summary: counts(result.findings),
      unreadable: result.unreadable,
      helmTemplates: result.helmTemplates,
      targets: result.targets.map((t) => ({
        file: t.file,
        line: t.line,
        kind: t.kind,
        name: t.name,
        image: t.image.raw,
        major: t.image.major,
        previousMajor: t.previousMajor,
        pgdata: t.pgdata,
        mounts: t.mounts.map((m) => ({ target: m.target, kind: m.kind, persistent: m.persistent })),
      })),
      findings: sortFindings(result.findings),
    },
    null,
    2,
  );
}
