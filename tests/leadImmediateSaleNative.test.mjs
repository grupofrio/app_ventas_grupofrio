import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,mocks={}) {const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/services/${file}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!(name in mocks))throw Error(name);return mocks[name];},setTimeout,clearTimeout});return exports;}
function setup() {
 let stored=null, seq=0, failResponse=false, failStorage=false, captures=0, resets=0;
 const requests=[]; const session={sessionId:'s1',employeeId:682,companyId:34};
 const queue=[];
 const visit={phase:'idle',currentStop:null,saleLines:[],resetVisit(){resets++;this.saleLines=[];},startVisit(stop){this.currentStop=stop;this.phase='checked_in';},setOffrouteVisitId(id){this.offrouteVisitId=id;}};
 const route={stops:[],addVirtualStop(){if(!this.stops.length)this.stops.push({id:-7,_virtualCreatedAt:Date.now()});return -7;},patchStop(id,stop){this.stops=this.stops.map(s=>s.id===id?stop:s);}};
 const stop={id:80,customer_id:9,customer_name:'Uno',phone:'7331234567',customer_latitude:18.3,customer_longitude:-99.5,pricelist_id:90,pricelist_name:'Iguala',_leadId:8,_partnerId:9,_entityType:'lead'};
 const result={lead_id:8,partner_id:9,visit_id:10,stop};
 const mocks={
  'expo-location':{Accuracy:{High:6},requestForegroundPermissionsAsync:async()=>({status:'granted'}),getCurrentPositionAsync:async()=>{captures++;return {coords:{latitude:18.3,longitude:-99.5,accuracy:12},timestamp:Date.now()};}},
  './fieldDataSession':{getFieldDataSession:async()=>session},
  './employeeDayBundle':{loadCurrentEmployeeDayBundle:async()=>({access:{canRunActions:true}})},
  './encryptedStore':{loadEncrypted:async()=>stored,saveEncrypted:async(_s,_k,d)=>{stored=structuredClone(d);},removeEncrypted:async()=>{stored=null;}},
  './fieldLeadIntakeFlow':load('fieldLeadIntakeFlow'), './leadIntake':load('leadIntake'),
  '../stores/useSyncStore':{useSyncStore:{getState:()=>({isOnline:true,enqueue:(_type,_body,opts)=>{queue.push(opts.operationId);return opts.operationId;},persistQueue:async()=>{},releaseProcessingHolds:()=>{},processQueue:async()=>{}})}},
  '../stores/useRouteStore':{useRouteStore:{getState:()=>route}},
  '../stores/useVisitStore':{useVisitStore:{getState:()=>visit},persistCurrentVisit:async()=>{if(failStorage)throw Error('storage failed');}},
  '../utils/clientEvent':{createUuidV4:()=>`id-${++seq}`},
  './apiRequestError':{getApiErrorCode:e=>e?.code},
  './api':{postRest:async(path,payload)=>{requests.push({path,payload:structuredClone(payload)});if(failResponse)throw Error('response lost');return {data:result};}},
  './planStopPayload':load('planStopPayload'),
  '../persistence/storage':{STORAGE_KEYS:{STOPS:'stops'},storeSaveStrict:async()=>{}},
 };
 return {native:load('fieldLeadIntakeNative',mocks),requests,visit,route,result,getStored:()=>stored,getCaptures:()=>captures,getResets:()=>resets,setFailResponse:v=>failResponse=v,setFailStorage:v=>failStorage=v};
}
const form={nombre:'Uno',telefono:'7331234567',direccion:'Negocio',giro:'abarrotes_miscelanea',notas:''};
test('fresh GPS then same lead opens one linked sale with server prices',async()=>{
 const h=setup();const gps=await h.native.captureLeadGps();assert.equal(h.getCaptures(),1);
 const n=await h.native.createNativeFieldLeadIntake();await n.flow.capture(form,gps);
 const result=await n.flow.sell();const id=await n.openSale(result,n.flow.getDraft().saleOperationId);
 assert.equal(id,-7);assert.equal(h.visit.currentStop._offrouteVisitId,10);assert.equal(h.visit.currentStop.customer_id,9);
 assert.equal(h.visit.currentStop._pricelistId,90);assert.equal(h.getStored(),null);assert.equal(h.getResets(),1);
 assert.match(h.requests[0].path,/lead\/start-sale$/);
});
test('lost server reply and failed local opening both recover without a second operation or clearing cart',async()=>{
 const h=setup();let n=await h.native.createNativeFieldLeadIntake();await n.flow.capture(form,null);
 h.setFailResponse(true);await assert.rejects(()=>n.flow.sell());
 h.setFailResponse(false);n=await h.native.createNativeFieldLeadIntake();await n.flow.restore();const result=await n.flow.sell();
 h.setFailStorage(true);await assert.rejects(()=>n.openSale(result,n.flow.getDraft().saleOperationId));
 h.visit.saleLines=[{productId:1,qty:2}];
 h.setFailStorage(false);n=await h.native.createNativeFieldLeadIntake();await n.flow.restore();const retry=await n.flow.sell();await n.openSale(retry,n.flow.getDraft().saleOperationId);
 assert.equal(h.requests.length,3);assert.deepEqual(h.requests[0].payload,h.requests[2].payload);
 assert.equal(h.getResets(),1);assert.equal(h.visit.saleLines.length,1);assert.equal(h.route.stops.length,1);
});
test('a different active visit makes no request and leaves the lead declineable',async()=>{
 const h=setup();const n=await h.native.createNativeFieldLeadIntake();await n.flow.capture(form,null);
 h.visit.phase='checked_in';h.visit.currentStop={id:99};
 await assert.rejects(()=>n.flow.sell());assert.equal(h.requests.length,0);assert.equal(n.flow.getDraft().phase,'queued');
 await n.flow.decline();assert.equal(h.getStored(),null);
});

test('local guard after a lost response preserves the recovery operation and blocks decline',async()=>{
 const h=setup();let n=await h.native.createNativeFieldLeadIntake();await n.flow.capture(form,null);
 const operationId=n.flow.getDraft().saleOperationId;
 h.setFailResponse(true);await assert.rejects(()=>n.flow.sell());
 h.setFailResponse(false);n=await h.native.createNativeFieldLeadIntake();await n.flow.restore();
 h.visit.phase='checked_in';h.visit.currentStop={id:99};
 await assert.rejects(()=>n.flow.sell());assert.equal(h.requests.length,1);
 assert.equal(n.flow.getDraft().phase,'selling');
 await assert.rejects(()=>n.flow.decline());assert.equal(h.getStored().saleOperationId,operationId);
 h.visit.phase='checked_out';await n.flow.sell();
 assert.deepEqual(h.requests[0].payload,h.requests[1].payload);
});
