import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const profile = JSON.parse(readFileSync('eas.json', 'utf8')).build['staging-android'];

for (const [file, variable, expected] of [
  ['src/services/api.ts', 'DEFAULT_BASE_URL', profile.env.EXPO_PUBLIC_KF_DEFAULT_BASE_URL],
  ['src/services/odooDatabase.ts', 'DEFAULT_ODOO_DB', profile.env.EXPO_PUBLIC_KF_ODOO_DB],
]) {
  test(`Android release embeds ${variable} without requiring device environment variables`, () => {
    const previous = { ...process.env };
    try {
      Object.assign(process.env, profile.env);
      const source = readFileSync(file, 'utf8');
      const declaration = source.slice(source.indexOf('const PUBLIC_DEFAULT_'), source.indexOf(';', source.indexOf(`export const ${variable}`)) + 1);
      const { code } = babel.transformSync(declaration, {
        filename: file, configFile: false, babelrc: false,
        presets: ['babel-preset-expo'],
        caller: { name: 'metro', platform: 'android', isDev: false, isServer: false, isNodeModule: false },
      });
      const sandbox = { exports: {}, process: { env: {} } };
      vm.runInNewContext(code, sandbox);
      assert.equal(sandbox.exports[variable], expected);
    } finally {
      for (const key of Object.keys(profile.env)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
}
