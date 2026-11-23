import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Resolved, src-relative import targets of a file (relative imports only). */
function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from '(\.[^']+)'/g)].map((m) =>
    relative(SRC, resolve(dirname(file), m[1])),
  );
}

function violations(scope: string, forbidden: RegExp): string[] {
  return files(join(SRC, scope)).flatMap((file) =>
    imports(file)
      .filter((target) => forbidden.test(target))
      .map((target) => `${relative(SRC, file)} -> ${target}`),
  );
}

describe('architecture boundaries', () => {
  it('Research depends on no other domain and not on core', () => {
    expect(violations('domain/research', /^(domain\/(account|publication)|core)\//)).toEqual([]);
  });

  it('Account depends on no other domain and not on core/auth', () => {
    expect(violations('domain/account', /^(domain\/(research|publication)|core)\//)).toEqual([]);
  });

  it('no module imports another domain repository', () => {
    const domains = readdirSync(join(SRC, 'domain')).filter((d) =>
      statSync(join(SRC, 'domain', d)).isDirectory(),
    );
    for (const domain of domains) {
      expect(
        violations(`domain/${domain}`, new RegExp(`^domain/(?!${domain}/)[^/]+/repository/`)),
      ).toEqual([]);
    }
    expect(violations('core', /^domain\/[^/]+\/repository\//)).toEqual([]);
    expect(violations('service', /^domain\//)).toEqual([]);
  });

  it('controllers never reach repositories or TypeORM directly', () => {
    const controllers = files(SRC).filter((f) => /\/controller\/|\.controller\.ts$/.test(f));
    for (const file of controllers) {
      const source = readFileSync(file, 'utf8');
      expect(`${relative(SRC, file)}: ${/from 'typeorm'|\/repository\//.test(source)}`).toBe(
        `${relative(SRC, file)}: false`,
      );
    }
  });
});
