import { describe, expect, it } from 'vitest';
import { parseImage } from '../src/image.js';

describe('parseImage', () => {
  it.each([
    ['postgres:18', 'postgres', 18, false],
    ['postgres:18.6-alpine3.24', 'postgres', 18, false],
    ['docker.io/library/postgres:17-bookworm', 'postgres', 17, false],
    ['public.ecr.aws/docker/library/postgres:18', 'postgres', 18, false],
    ['postgres:18@sha256:abc', 'postgres', 18, false],
    ['postgres', 'postgres', 18, true],
    ['postgres:latest', 'postgres', 18, true],
    ['postgres:alpine', 'postgres', 18, true],
    ['postgis/postgis:18-3.6-alpine', 'postgis', 18, false],
    ['pgvector/pgvector:pg18', 'pgvector', 18, false],
    ['pgvector/pgvector:0.8.1-pg17-bookworm', 'pgvector', 17, false],
    ['timescale/timescaledb:latest-pg18', 'timescaledb', 18, false],
    ['pgautoupgrade/pgautoupgrade:18-alpine', 'pgautoupgrade', 18, false],
  ])('%s -> %s %s', (ref, family, major, floating) => {
    const img = parseImage(ref);
    expect(img?.family).toBe(family);
    expect(img?.major).toBe(major);
    expect(img?.floating).toBe(floating);
  });

  it('keeps the major unknown for a digest-only reference', () => {
    expect(parseImage('postgres@sha256:abc')?.major).toBeNull();
  });

  it('ignores images that are not Postgres, or still contain a variable', () => {
    expect(parseImage('redis:7')).toBeNull();
    expect(parseImage('mypostgres:18')).toBeNull();
    expect(parseImage('postgres:${PG}')).toBeNull();
  });

  it('marks images with their own data layout', () => {
    expect(parseImage('bitnami/postgresql:18')?.layout).toBe('other');
    expect(parseImage('timescale/timescaledb-ha:pg18')?.layout).toBe('other');
  });
});
