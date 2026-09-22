import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const createConfig = require('../app.config.js');

delete process.env.KF_LOCAL_DEV;
const production = createConfig();
assert.equal(production.name, 'KOLD Field');
assert.equal(production.android.package, 'mx.grupofrio.koldfield');
assert.equal(production.scheme, 'kold-field');

process.env.KF_LOCAL_DEV = '1';
const development = createConfig();
assert.equal(development.name, 'KOLD Field Dev');
assert.equal(development.android.package, 'mx.grupofrio.koldfield.dev');
assert.equal(development.scheme, 'kold-field-dev');

delete process.env.KF_LOCAL_DEV;
console.log('local Android dev variant tests: ok');
