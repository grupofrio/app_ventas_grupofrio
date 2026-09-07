import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLastKnownCatalog, readLastKnownCatalog, rememberCatalogProduct, sameCatalogContext } from '../src/services/lastKnownCatalog.ts';
const context={companyId:1,employeeId:2,warehouseId:3,mobileLocationId:4};
const product=(id:number)=>({id,name:`Product ${id}`,list_price:20,qty_available:5,sale_ok:true,product_tmpl_id:[id,'Product'] as [number,string],qty_reserved:0,qty_display:5,_totalKg:5,_isGlobalFallback:false as const,weight:1});
test('last-known catalog survives day changes with original download time',()=>{
 const snapshot=buildLastKnownCatalog(context,[product(1)],100,null);
 assert.equal(readLastKnownCatalog(snapshot,context)?.fetchedAtMs,100);
 assert.equal(readLastKnownCatalog(JSON.parse(JSON.stringify(snapshot)),context)?.products[0].id,1);
});
test('rejects every mismatched scope and missing logistics identity',()=>{
 const snapshot=buildLastKnownCatalog(context,[product(1)],100,null);
 for(const key of Object.keys(context)) assert.equal(readLastKnownCatalog(snapshot,{...context,[key]:99}),null);
 assert.equal(readLastKnownCatalog(snapshot,{...context,mobileLocationId:0}),null);
 assert.equal(sameCatalogContext(context,{...context,employeeId:5}),false);
});
test('bounds recent products and recovers missing products as unknown stock',()=>{
 let snapshot=buildLastKnownCatalog(context,Array.from({length:105},(_,i)=>product(i+1)),100,null);
 for(let i=1;i<=105;i++) snapshot=rememberCatalogProduct(snapshot,i,100+i);
 assert.equal(snapshot.recent.length,100);
 const refreshed=buildLastKnownCatalog(context,[],300,snapshot);
 const restored=readLastKnownCatalog(refreshed,context)!;
 assert.equal(restored.products.length,100);
 assert.equal(restored.products[0].qty_display,0);
 assert.equal(restored.products[0].qty_reserved,0);
 assert.equal(restored.products[0].list_price,20);
});
test('rejects corrupt envelopes and does not copy unknown persisted fields',()=>{
 assert.equal(readLastKnownCatalog({version:2},context),null);
 const snapshot=buildLastKnownCatalog(context,[{...product(1),secret:'discard'}],100,null);
 assert.equal('secret' in snapshot.products[0],false);
 assert.equal(readLastKnownCatalog({...snapshot,fetchedAtMs:NaN},context),null);
 assert.equal(buildLastKnownCatalog(context,[{...product(1),id:-1}],100,null).products.length,0);
});
