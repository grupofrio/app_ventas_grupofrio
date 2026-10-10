import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const guardPath = path.join(repoRoot, 'scripts', 'verify-qa-build-config.mjs');
const easPath = path.join(repoRoot, 'eas.json');

function runGuard(configPath = easPath) {
  return spawnSync(
    process.execPath,
    [guardPath, '--profile', 'qa-kold114', '--eas-config', configPath],
    { cwd: repoRoot, encoding: 'utf8' },
  );
}

const valid = runGuard();
assert.equal(valid.status, 0, valid.stderr || valid.stdout);
const resolved = JSON.parse(valid.stdout);
assert.deepEqual(resolved, {
  profile: 'qa-kold114',
  developmentBuild: 38842081,
  publicBaseUrl: 'https://grupofrio-gf-codex-dev-pr291-kold114-79983ae-38842081.dev.odoo.com',
  publicOdooDb: 'grupofrio-gf-codex-dev-pr291-kold114-79983ae-38842081',
  applicationId: 'mx.grupofrio.koldfield.dev',
  version: '1.4.5',
  versionCode: 11,
  certificateSha256: '3b536a000d4dc09b77fd7704a535df506cdc33443dc7e80a7c4428b1f1369e54',
  remoteCredentials: true,
});

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'kold114-qa-guard-'));
const original = readFileSync(easPath, 'utf8');

const productionConfig = path.join(tempDir, 'production-eas.json');
writeFileSync(
  productionConfig,
  original
    .replace(
      'https://grupofrio-gf-codex-dev-pr291-kold114-79983ae-38842081.dev.odoo.com',
      'https://grupofrio-gf.odoo.com',
    )
    .replace(
      'grupofrio-gf-codex-dev-pr291-kold114-79983ae-38842081',
      'grupofrio-gf-main-34980678',
    ),
  'utf8',
);
const production = runGuard(productionConfig);
assert.notEqual(production.status, 0);
assert.match(production.stderr, /authorized Development hostname/i);

const wrongBuildConfig = path.join(tempDir, 'wrong-build-eas.json');
writeFileSync(
  wrongBuildConfig,
  original.replaceAll('38842081', '38842082'),
  'utf8',
);
const wrongBuild = runGuard(wrongBuildConfig);
assert.notEqual(wrongBuild.status, 0);
assert.match(wrongBuild.stderr, /Development build 38842081/i);

console.log('QA build configuration guard tests: ok');
