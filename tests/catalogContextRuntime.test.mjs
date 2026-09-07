import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as cache from '../src/services/persistentCache.ts';
import * as catalog from '../src/services/lastKnownCatalog.ts';

function harness() {
  let state;
  const route = { plan: { plan_id: 5, warehouse_id: 3, mobile_location_id: 4 } };
  const auth = { companyId: 1, employeeId: 2 };
  const disk = new Map();
  let resolveFetch;
  let fetching;
  const started = new Promise(resolve => { fetching=resolve; });
  const mocks = {
    zustand: {create: init => {state=init(p=>{state={...state,...(typeof p==='function'?p(state):p)};},()=>state);return {getState:()=>state};}},
    '../persistence/storage': {storeSave:async(k,v)=>disk.set(k,v),storeLoad:async k=>disk.get(k)??null,storeRemove:async k=>disk.delete(k),STORAGE_KEYS:{PRODUCTS_CATALOG:'daily',PRODUCTS:'legacy'}},
    '../services/gfLogistics': {fetchTruckStock:()=>{fetching();return new Promise(resolve=>{resolveFetch=resolve;});}},
    '../utils/logger': {logInfo(){},logWarn(){}},
    './useAuthStore': {useAuthStore:{getState:()=>auth}},
    './useRouteStore': {useRouteStore:{getState:()=>route}},
    '../services/persistentCache': cache,
    '../utils/localDate': {todayLocalISO:()=> '2026-09-07'},
    '../services/offlineCache': {schedulePersistPriceCache(){}},
    '../services/lastKnownCatalog.ts': catalog,
    '../services/lastKnownCatalogRepository.ts': {loadLastKnownCatalog:async()=>null,saveLastKnownCatalog:async()=>{},rememberLastKnownProduct:async()=>{}},
    '../services/fieldDataSession.ts': {getFieldDataSession:async()=>null},
    './useSyncStore.ts': {useSyncStore:{getState:()=>({queue:[]})}},
    '../services/ambiguousAckReconcileRuntime.ts': {reconcileAmbiguousLedgerOpsAgainstStore:async()=>{}},
    '../services/inventoryLedger.ts': {rebaseAfterTruckStockRefresh:async()=>{}},
  };
  const source=readFileSync(new URL('../src/stores/useProductStore.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  new Function('require','exports',compiled)(name=>{if(!(name in mocks))throw new Error(`Unexpected import ${name}`);return mocks[name];},exports);
  return {get state(){return state;},route,disk,started,resolve:value=>resolveFetch(value)};
}
const product={id:1,name:'Hielo',sale_ok:true,list_price:10,qty_available:5,product_tmpl_id:[1,'Hielo'],weight:5};

test('same-plan location change discards an in-flight truck-stock response',async()=>{
 const h=harness(); const pending=h.state.loadProducts();await h.started;
 h.route.plan.mobile_location_id=99;
 h.resolve({products:[product],warehouseId:3,locationId:4,hasStockData:true,inventorySource:'truck_stock'});
 await pending;
 assert.equal(h.state.products.length,0);
 assert.equal(h.disk.size,0);
 assert.equal(h.state.isLoading,false);
});

test('same-plan reassignment cannot restore the old daily cache',async()=>{
 const h=harness();const pending=h.state.loadProducts();await h.started;
 h.resolve({products:[product],warehouseId:3,locationId:4,hasStockData:true,inventorySource:'truck_stock'});await pending;
 assert.equal(h.state.products.length,1);assert.ok(h.disk.has('daily'));
 h.state.reset();h.route.plan.mobile_location_id=99;
 assert.equal(await h.state.hydrateFromCache(5),0);assert.equal(h.state.products.length,0);
});

test('refresh transport failure keeps the previously loaded catalog',async()=>{
 const h=harness();const pending=h.state.loadProducts();await h.started;
 h.resolve({products:[product],warehouseId:3,locationId:4,hasStockData:true,inventorySource:'truck_stock'});await pending;
 const next=h.state.loadProducts();await new Promise(resolve=>setImmediate(resolve));
 h.resolve({get products(){throw new Error('network failure');}});await next;
 assert.equal(h.state.products[0].id,1);assert.ok(h.state.error);
});
