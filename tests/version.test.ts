import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_URL, PACKAGE_VERSION } from '../src/ui/version';

describe('board menu package identity', () => {
  it('matches package.json so the version footer stays current', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
      homepage: string;
    };
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(pkg.homepage).toBe(SITE_URL);
  });
});
