import { describe, expect, it } from 'vitest';
import { parseShortVolume } from '../src/sources/compose.js';
import { parseDockerfile } from '../src/sources/dockerfile.js';
import { interpolate, parseDotenv } from '../src/sources/util.js';

describe('interpolate', () => {
  const vars = new Map([['PG', '18'], ['EMPTY', '']]);
  it.each([
    ['postgres:${PG}', 'postgres:18'],
    ['postgres:$PG', 'postgres:18'],
    ['postgres:${MISSING:-17}', 'postgres:17'],
    ['postgres:${EMPTY:-17}', 'postgres:17'],
    ['postgres:${EMPTY-17}', 'postgres:'],
    ['postgres:${MISSING}', 'postgres:${MISSING}'],
    ['a$$b', 'a$b'],
  ])('%s -> %s', (input, out) => {
    expect(interpolate(input, vars)).toBe(out);
  });
});

describe('parseDotenv', () => {
  it('reads quotes, export and comments', () => {
    const env = parseDotenv('# c\nexport A=1\nB="two words"\nC=3 # note\n');
    expect([...env]).toEqual([['A', '1'], ['B', 'two words'], ['C', '3']]);
  });
});

describe('parseShortVolume', () => {
  it('tells named volumes, bind mounts and anonymous volumes apart', () => {
    expect(parseShortVolume('pgdata:/var/lib/postgresql/data', 1)?.kind).toBe('named-volume');
    expect(parseShortVolume('./data:/var/lib/postgresql/data:rw', 1)?.kind).toBe('bind');
    expect(parseShortVolume('/var/lib/postgresql/data', 1)?.kind).toBe('anonymous');
    expect(parseShortVolume('C:\\pg:/var/lib/postgresql', 1)).toMatchObject({ kind: 'bind', target: '/var/lib/postgresql' });
  });
});

describe('parseDockerfile', () => {
  it('uses the final stage, ARG defaults, both ENV forms and VOLUME', () => {
    const info = parseDockerfile(
      'ARG V=18\nFROM node:24 AS build\nENV PGDATA=/wrong\nFROM --platform=linux/amd64 postgres:${V}-alpine AS db\nENV PGDATA /var/lib/postgresql/data\nENV A=1 \\\n    POSTGRES_INITDB_ARGS="--no-data-checksums"\nVOLUME /var/lib/postgresql/data\n',
    );
    expect(info.from).toBe('postgres:18-alpine');
    expect(info.stage).toBe('db');
    expect(info.env.get('PGDATA')).toBe('/var/lib/postgresql/data');
    expect(info.env.get('POSTGRES_INITDB_ARGS')).toBe('--no-data-checksums');
    expect(info.volumes).toEqual([{ path: '/var/lib/postgresql/data', line: 8 }]);
  });
});
