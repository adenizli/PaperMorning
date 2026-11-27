import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigValidationError, loadAppConfig } from '../../src/config/app.config';
import { describeSandbox } from '../../src/service/pdf/pdf.service';

/**
 * Regression for the production failure "Chromium sandboxing failed!": `.env` contained
 * PDF_CHROMIUM_SANDBOX=true (correct for a plain host), and docker-compose.yml interpolated it into
 * the hardened container, where Chromium's sandbox cannot start.
 */
describe('Chromium sandbox configuration', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32) };
  const container = { ...base, PAPERMORNING_RUNTIME: 'container' };

  it('auto (default) keeps the sandbox ON on a normal host', () => {
    const { pdf } = loadAppConfig(base);
    expect(pdf).toMatchObject({
      chromiumSandbox: true,
      chromiumSandboxSource: 'auto',
      runtime: 'host',
    });
    expect(loadAppConfig({ ...base, PDF_CHROMIUM_SANDBOX: 'auto' }).pdf.chromiumSandbox).toBe(true);
  });

  it('auto (default) turns the sandbox OFF inside the official container', () => {
    const { pdf } = loadAppConfig(container);
    expect(pdf).toMatchObject({
      chromiumSandbox: false,
      chromiumSandboxSource: 'auto',
      runtime: 'container',
    });
    expect(describeSandbox(loadAppConfig(container))).toMatch(/OFF \(auto, runtime container\)/);
  });

  it('rejects an explicit true inside the container at startup, naming the fix', () => {
    expect.assertions(3);
    try {
      loadAppConfig({ ...container, PDF_CHROMIUM_SANDBOX: 'true' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = (error as Error).message;
      expect(message).toMatch(
        /PDF_CHROMIUM_SANDBOX=true cannot work inside the PaperMorning container/,
      );
      expect(message).toMatch(/PDF_CHROMIUM_SANDBOX=auto/);
    }
  });

  it('honours explicit values where they can work', () => {
    expect(loadAppConfig({ ...container, PDF_CHROMIUM_SANDBOX: 'false' }).pdf).toMatchObject({
      chromiumSandbox: false,
      chromiumSandboxSource: 'explicit',
    });
    expect(loadAppConfig({ ...base, PDF_CHROMIUM_SANDBOX: 'false' }).pdf.chromiumSandbox).toBe(
      false,
    );
    expect(loadAppConfig({ ...base, PDF_CHROMIUM_SANDBOX: 'true' }).pdf.chromiumSandbox).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(() => loadAppConfig({ ...base, PDF_CHROMIUM_SANDBOX: 'maybe' })).toThrow(
      /PDF_CHROMIUM_SANDBOX must be auto, true or false/,
    );
    expect(() => loadAppConfig({ ...base, PAPERMORNING_RUNTIME: 'vm' })).toThrow(
      /PAPERMORNING_RUNTIME must be one of host, container/,
    );
  });

  describe('deployment files', () => {
    const root = join(__dirname, '..', '..');
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const server = compose.slice(compose.indexOf('\n  server:'), compose.indexOf('\n  mailpit:'));

    it('compose fixes the container value instead of interpolating it from .env', () => {
      expect(server).toMatch(/^\s+PDF_CHROMIUM_SANDBOX: 'false'\s*$/m);
      expect(compose).not.toMatch(/PDF_CHROMIUM_SANDBOX:\s*\$\{/);
    });

    it('the image declares the container runtime', () => {
      expect(dockerfile).toMatch(/PAPERMORNING_RUNTIME=container/);
    });

    it('keeps every container hardening measure', () => {
      expect(server).toMatch(/^\s+user: node\b/m);
      expect(server).toMatch(/^\s+read_only: true\b/m);
      expect(server).toMatch(/^\s+cap_drop: \[ALL\]/m);
      expect(server).toMatch(/no-new-privileges:true/);
      expect(server).toMatch(/^\s+pids_limit: \d+/m);
      expect(server).toMatch(/^\s+mem_limit: \S+/m);
      expect(server).toMatch(/^\s+init: true\b/m);
      expect(server).toMatch(/\/tmp:rw,nosuid,nodev,noexec/);
      expect(compose).not.toMatch(/privileged:\s*true/);
      expect(compose).not.toMatch(/seccomp[:=]\s*unconfined/);
      expect(compose).not.toMatch(/cap_add/);
      expect(dockerfile).toMatch(/^USER node$/m);
    });
  });
});
