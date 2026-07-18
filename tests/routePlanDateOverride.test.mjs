import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/gfLogistics.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /EXPO_PUBLIC_KF_QA_ROUTE_DATE/,
  'gfLogistics must support EXPO_PUBLIC_KF_QA_ROUTE_DATE for future-dated staging route smoke tests',
);

assert.match(
  source,
  /fetchMyPlan\([\s\S]*?`\$\{GF_BASE\}\/my_plan`,[\s\S]*?getMyPlanDate\(\)/,
  'getMyPlan must send the QA-overridable plan date to /my_plan',
);

assert.match(
  source,
  /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/,
  'the QA route date override must be accepted only as YYYY-MM-DD',
);

console.log('route plan date override tests: ok');
