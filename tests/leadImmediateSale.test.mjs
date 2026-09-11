import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load() {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/fieldLeadIntakeFlow.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
 return exports;
}
test('GPS must be fresh, precise and within coordinates range',()=>{
 const {validateLeadGps}=load();
 assert.equal(validateLeadGps({latitude:18.3,longitude:-99.5,accuracy:15,timestamp:1000},2000).latitude,18.3);
 for(const point of [null,{latitude:0,longitude:0,accuracy:1,timestamp:1000},{latitude:18,longitude:-99,accuracy:500,timestamp:1000},{latitude:18,longitude:-99,accuracy:10,timestamp:1}]) assert.throws(()=>validateLeadGps(point,200000));
});
test('draft persists before queue and recovery reuses the same operation',async()=>{
 const {createFieldLeadIntakeFlow}=load(); let stored=null, uuid=0, fail=true;const queued=[];
 const deps={uuid:()=>`uuid-${++uuid}`,load:async()=>stored,save:async x=>{stored=structuredClone(x);},remove:async()=>{stored=null;},enqueue:(id,payload)=>{queued.push(id);return id;},persistQueue:async()=>{if(fail)throw Error('disk');},release:()=>{},process:()=>{},startSale:async()=>{},isOnline:()=>true};
 const first=createFieldLeadIntakeFlow(deps);
 await assert.rejects(()=>first.capture({nombre:'Uno'},null));
 assert.equal(stored.operationId,'uuid-1');
 fail=false;const resumed=createFieldLeadIntakeFlow(deps);await resumed.restore();await resumed.capture({nombre:'Otro'},null);
 assert.deepEqual(queued,['uuid-1','uuid-1']);assert.equal(stored.form.nombre,'Uno');
});
test('declining does not convert; sale retries preserve idempotency',async()=>{
 const {createFieldLeadIntakeFlow}=load();let stored=null,calls=[],fail=true,n=0;
 const deps={uuid:()=>`uuid-${++n}`,load:async()=>stored,save:async x=>{stored=structuredClone(x);},remove:async()=>{stored=null;},enqueue:id=>id,persistQueue:async()=>{},release:()=>{},process:()=>{},isOnline:()=>true,startSale:async x=>{calls.push(x);if(fail)throw Error('lost response');return {visitId:7};}};
 const flow=createFieldLeadIntakeFlow(deps);await flow.capture({nombre:'Uno'},null);await flow.decline();assert.equal(calls.length,0);
 await flow.capture({nombre:'Dos'},null);await assert.rejects(()=>flow.sell());const prior=calls[0];
 fail=false;const resumed=createFieldLeadIntakeFlow(deps);await resumed.restore();await resumed.sell();assert.deepEqual(calls[1],prior);
});
test('missing data can be corrected on the same lead; ambiguous edit reuses its id',async()=>{
 const {createFieldLeadIntakeFlow}=load();let stored=null,n=0,fail=true;const updates=[];
 const deps={uuid:()=>`uuid-${++n}`,load:async()=>stored,save:async d=>{stored=structuredClone(d);},remove:async()=>{},enqueue:id=>id,persistQueue:async()=>{},release:()=>{},process:()=>{},isOnline:()=>true,updateLead:async payload=>{updates.push(payload);if(fail)throw Error('lost');}};
 const flow=createFieldLeadIntakeFlow(deps);await flow.capture({nombre:'Uno',telefono:''},null);
 await assert.rejects(()=>flow.update({nombre:'Uno',telefono:'7331234567'},null));
 const resumed=createFieldLeadIntakeFlow(deps);await resumed.restore();fail=false;
 await resumed.update({nombre:'Changed',telefono:'000'},null);
 assert.equal(updates[0].lead_operation_id,'uuid-1');assert.deepEqual(structuredClone(updates[1]),structuredClone(updates[0]));
 assert.equal(stored.form.telefono,'7331234567');assert.equal(stored.operationId,'uuid-1');
});
