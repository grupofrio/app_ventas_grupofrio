# Local Android Dev Variant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a Metro-connected `KOLD Field Dev` beside the production APK on the same Android phone.

**Architecture:** Add an Expo dynamic configuration that clones the existing production configuration and changes only the app name, Android package, and URL scheme when `KF_LOCAL_DEV=1`. A Node wiring test will prove both identities so release commands remain production-safe.

**Tech Stack:** Expo SDK 52 dynamic app configuration, Node.js assertions, Android/Gradle, PowerShell.

---

### Task 1: Lock the production and development identities with a test

**Files:**
- Create: `tests/localAndroidDevVariant.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/localAndroidDevVariant.test.mjs
```

Expected: FAIL because `app.config.js` does not exist.

### Task 2: Implement the isolated Expo configuration

**Files:**
- Create: `app.config.js`
- Test: `tests/localAndroidDevVariant.test.mjs`

- [ ] **Step 1: Create the minimal dynamic configuration**

```js
const { expo: productionConfig } = require('./app.json');

module.exports = function createExpoConfig() {
  const localDev = process.env.KF_LOCAL_DEV === '1';

  return {
    ...productionConfig,
    name: localDev ? 'KOLD Field Dev' : productionConfig.name,
    scheme: localDev ? 'kold-field-dev' : productionConfig.scheme,
    android: {
      ...productionConfig.android,
      package: localDev
        ? 'mx.grupofrio.koldfield.dev'
        : productionConfig.android.package,
    },
  };
};
```

- [ ] **Step 2: Run the focused test**

Run:

```powershell
node tests/localAndroidDevVariant.test.mjs
```

Expected: `local Android dev variant tests: ok`.

- [ ] **Step 3: Verify Expo's resolved production configuration**

Run:

```powershell
Remove-Item Env:KF_LOCAL_DEV -ErrorAction SilentlyContinue
npx expo config --type public --json
```

Expected JSON fields: `name` is `KOLD Field`, `android.package` is `mx.grupofrio.koldfield`, and `scheme` is `kold-field`.

- [ ] **Step 4: Verify Expo's resolved development configuration**

Run:

```powershell
$env:KF_LOCAL_DEV="1"
npx expo config --type public --json
```

Expected JSON fields: `name` is `KOLD Field Dev`, `android.package` is `mx.grupofrio.koldfield.dev`, and `scheme` is `kold-field-dev`.

- [ ] **Step 5: Run repository validation**

Run:

```powershell
npm run typecheck
node tests/androidReleaseContinuity.test.mjs
git diff --check
```

Expected: all commands pass.

- [ ] **Step 6: Commit the implementation**

```powershell
git add app.config.js tests/localAndroidDevVariant.test.mjs
git commit -m "build(android): add isolated local dev variant"
```

### Task 3: Generate and install the local variant on the connected phone

**Files:**
- Generated and ignored: `android/`

- [ ] **Step 1: Confirm the phone remains authorized**

Run:

```powershell
adb devices
```

Expected: `R5CT60ZLR4V device`.

- [ ] **Step 2: Regenerate Android with the development identity**

Run:

```powershell
$env:KF_LOCAL_DEV="1"
npx expo prebuild --platform android --clean
```

Expected: generated Android `applicationId` is `mx.grupofrio.koldfield.dev`.

- [ ] **Step 3: Install and start the development client**

Run:

```powershell
npm run android -- --device R5CT60ZLR4V
```

Expected: `KOLD Field Dev` installs without replacing `KOLD Field` and opens connected to Metro.

- [ ] **Step 4: Confirm both packages are installed**

Run:

```powershell
adb -s R5CT60ZLR4V shell pm list packages | Select-String 'mx.grupofrio.koldfield'
```

Expected:

```text
package:mx.grupofrio.koldfield
package:mx.grupofrio.koldfield.dev
```
