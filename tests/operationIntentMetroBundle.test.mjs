import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = process.cwd();

test('production Android bundle resolves sale diagnostics without node:crypto', {
  timeout: 120_000,
}, () => {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'sale-diagnostics-bundle-'));
  const bundlePath = resolve(outputRoot, 'sale-diagnostics.production.android.bundle');

  try {
    const result = spawnSync(
      resolve(repoRoot, 'node_modules/.bin/expo'),
      [
        'export:embed',
        '--platform',
        'android',
        '--dev',
        'false',
        '--minify',
        'true',
        '--entry-file',
        'tests/fixtures/saleDiagnosticsBundleEntry.ts',
        '--bundle-output',
        bundlePath,
        '--assets-dest',
        resolve(outputRoot, 'assets'),
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, CI: '1' },
      },
    );

    assert.equal(
      result.status,
      0,
      `Metro bundle failed:\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(existsSync(bundlePath), true);

    const bundleSource = readFileSync(bundlePath, 'utf8');
    assert.doesNotMatch(bundleSource, /node:crypto/);
    assert.doesNotMatch(bundleSource, /Unable to resolve module node:crypto/);
    assert.match(bundleSource, /fingerprintOperationPayload|diagnosticFingerprint/);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
