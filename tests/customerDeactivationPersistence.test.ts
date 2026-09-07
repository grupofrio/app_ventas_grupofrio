import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as persistence from '../src/services/customerDeactivationPersistence.ts';
const scope={companyId:1,employeeId:2,sessionId:'a',planId:3,operationalDate:'2026-09-07'};
const result={request_id:8,stop_id:5,partner_id:7,state:'rejected',reason:'other'};
test('ACK remains readable after queue completion, isolated by session and day', async()=>{
 const factory=(persistence as any).createCustomerDeactivationPersistence;
 assert.equal(typeof factory,'function');
 let stored:any=null;
 let current={...scope};
 const service=factory({getScope:async()=>current,save:async(identity:any,key:string,value:any)=>{assert.equal(identity.sessionId,'a');stored=value;},load:async()=>stored});
 await service.save(scope,5,result);
 assert.deepEqual(await service.load(scope,5),result);
 current={...scope,sessionId:'b'};
 await assert.rejects(()=>service.load(scope,5));
 current={...scope}; stored={...stored,scope:{...scope,operationalDate:'2026-09-06'}};
 await assert.rejects(()=>service.load(scope,5));
});
test('session change during durable ACK write prevents applying result',async()=>{
 const factory=(persistence as any).createCustomerDeactivationPersistence;
 assert.equal(typeof factory,'function');
 let current={...scope};
 const service=factory({getScope:async()=>current,save:async()=>{current={...scope,sessionId:'b'};},load:async()=>null});
 await assert.rejects(()=>service.save(scope,5,result));
});
