import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStagingMutationGuard,
  StagingBackendUnverifiedError,
} from '../src/stores/useStagingBackendStore.ts';

test('rejects a staging mutation before backend verification', () => {
  const guard = createStagingMutationGuard(() => ({
    status: 'unverified',
    baseUrl: 'https://odoo-staging.grupofrio.com',
    host: 'odoo-staging.grupofrio.com',
    db: null,
    reason: 'database_unavailable',
  }));

  assert.throws(
    () => guard('https://odoo-staging.grupofrio.com/gf/logistics/api/employee/sales/create'),
    StagingBackendUnverifiedError,
  );
});

test('accepts only requests below the verified staging base URL', () => {
  const guard = createStagingMutationGuard(() => ({
    status: 'verified',
    baseUrl: 'https://odoo-staging.grupofrio.com',
    host: 'odoo-staging.grupofrio.com',
    db: 'staging-db',
    reason: null,
  }));

  assert.doesNotThrow(() =>
    guard('https://odoo-staging.grupofrio.com/gf/logistics/api/employee/sales/create'),
  );
  assert.throws(
    () => guard('https://grupofrio-gf.odoo.com/gf/logistics/api/employee/sales/create'),
    StagingBackendUnverifiedError,
  );
});

test('configured staging permits its origin but rejects production and other DBs', () => {
  const identity = {status:'configured' as const,baseUrl:'https://odoo-staging.grupofrio.mx',host:'odoo-staging.grupofrio.mx',db:'grupofrio-gf-staging280826-37235488',reason:null};
  const guard=createStagingMutationGuard(()=>identity);
  assert.doesNotThrow(()=>guard(identity.baseUrl+'/gf/logistics/api/employee/sales/create'));
  assert.throws(()=>guard('https://grupofrio-gf.odoo.com/api/employee-sign-in'),StagingBackendUnverifiedError);
  assert.throws(()=>createStagingMutationGuard(()=>({...identity,db:'production'}))(identity.baseUrl+'/api'),StagingBackendUnverifiedError);
});
