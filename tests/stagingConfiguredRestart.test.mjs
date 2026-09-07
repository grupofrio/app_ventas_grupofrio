import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as identityHelpers from '../src/services/stagingBackendIdentity.ts';
import * as environment from '../src/config/appEnvironment.ts';
function setup(baseUrl) {
 let state,identity={status:'unverified'};
 const mocks={
  zustand:{create:init=>{state=init(p=>{state={...state,...p};});return {getState:()=>state};}},
  'expo-constants':{default:{expoConfig:{extra:{appEnvironment:'staging',defaultBaseUrl:'https://odoo-staging.grupofrio.mx',defaultOdooDb:'grupofrio-gf-staging280826-37235488',stagingUseConfiguredDb:true}}}},
  '../services/api':{getBaseUrl:async()=>baseUrl},
  '../persistence/storage':{storeLoad:async()=>({employeeId:1,companyId:2}),storeRemove:async()=>{},STORAGE_KEYS:{AUTH_STATE:'auth'}},
  '../services/authOffline':{isRestorableSession:()=>({ok:true})},
  '../services/fieldDataSession':{setFieldDataIdentity(){}},
  '../services/stagingBackendIdentity.ts':identityHelpers,
  '../config/appEnvironment.ts':environment,
  './useStagingBackendStore.ts':{useStagingBackendStore:{getState:()=>({clearIdentity:()=>{identity={status:'unverified'};},setIdentity:i=>{identity=i;}})}},
 };
 const source=readFileSync('src/stores/useAuthStore.ts','utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:false}}).outputText;
 new Function('require','exports',compiled)(key=>mocks[key]??{},{});
 return {get state(){return state;},get identity(){return identity;}};
}
test('retained staging session restores configured identity before authenticating',async()=>{
 const h=setup('https://odoo-staging.grupofrio.mx');
 assert.equal(await h.state.rehydrateAuth(),true);
 assert.equal(h.identity.status,'configured');assert.equal(h.state.isAuthenticated,true);
});
test('old or production saved origin requires login again without trusting old tokens',async()=>{
 const h=setup('https://grupofrio-gf.odoo.com');
 assert.equal(await h.state.rehydrateAuth(),false);assert.equal(h.state.isAuthenticated,false);assert.equal(h.identity.status,'unverified');
});
