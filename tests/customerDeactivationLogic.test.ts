import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as logic from '../src/services/customerDeactivationLogic.ts';

test('queued work never claims server review and terminal states end review', () => {
 assert.equal(logic.buildCustomerDeactivationStopPatch({reason:'other'}).deactivation_state,'queued');
 assert.equal(logic.buildCustomerDeactivationStopPatch({reason:'other'}).deactivation_under_review,false);
 for (const state of ['rejected','applied']) assert.equal(logic.buildCustomerDeactivationStopPatch({reason:'other',state}).deactivation_under_review,false);
 assert.equal(logic.buildCustomerDeactivationStopPatch({reason:'other',state:'pending_sugey',requestId:3}).deactivation_under_review,true);
});
test('GPS must be within geographic bounds', () => {
 assert.ok(logic.validateCustomerDeactivationRequest({reason:'other',comment:'Test',latitude:91,longitude:0}));
 assert.ok(logic.validateCustomerDeactivationRequest({reason:'other',comment:'Test',latitude:0,longitude:181}));
});
test('employee response must explicitly acknowledge a known request for the same stop', () => {
 const parse = (logic as any).parseCustomerDeactivationResponse;
 assert.equal(typeof parse,'function');
 const request = {request_id:3,stop_id:5,partner_id:7,state:'rejected',reason:'other'};
 assert.deepEqual(parse({ok:true,data:{request}},5),request);
 assert.deepEqual(parse(request,5,false,7),request);
 assert.throws(()=>parse(request,5,false,8));
 for (const response of [{}, {ok:false,data:{request}}, {ok:true,data:{request:{...request,state:'wat'}}}, {ok:true,data:{request:{...request,stop_id:6}}}]) assert.throws(()=>parse(response,5));
 assert.equal(parse({ok:true,data:{request:null}},5,true),null);
 assert.throws(()=>parse({ok:true,data:{request:null}},5));
});
test('queued request sends only bounded employee capture fields and UUID operation_id', () => {
 const normalize = (logic as any).normalizeCustomerDeactivationPayload;
 assert.equal(typeof normalize,'function');
 const input = {operation_id:'11111111-1111-4111-8111-111111111111',stop_id:5,reason:'other',comment:' test ',contact_person:null,latitude:10,longitude:20,accuracy:null,captured_at:'2026-09-07T12:00:00.000Z',partner_id:7,partner_name:'Customer',route_plan_id:3,route_name:'Route',company_id:1,_operationId:'local',_deactivationScope:{},localPhotoUri:null};
 const actual = normalize(input);
 assert.equal(actual.client_operation_id,input.operation_id); assert.equal(actual.operation_id,undefined); assert.equal(actual.comment,'test'); assert.equal(actual._deactivationScope,undefined); assert.equal(actual.localPhotoUri,undefined);
 assert.throws(()=>normalize({...input,employee_id:9}));
 assert.throws(()=>normalize({...input,operation_id:'old-local-key'}));
});
test('scope prevents another session, plan or day from using a captured request', () => {
 const same = (logic as any).sameCustomerDeactivationScope;
 assert.equal(typeof same,'function');
 const scope={companyId:1,employeeId:2,sessionId:'session',planId:3,operationalDate:'2026-09-07'};
 assert.equal(same(scope,{...scope}),true);
 for (const change of [{sessionId:'other'},{employeeId:4},{companyId:4},{planId:4},{operationalDate:'2026-09-08'}]) assert.equal(same(scope,{...scope,...change}),false);
});
test('duplicate queued customer request is found across stops, including dead work', () => {
 const duplicate = (logic as any).findQueuedCustomerDeactivation;
 assert.equal(typeof duplicate,'function');
 const queue=[{type:'customer_deactivation_request',status:'dead',payload:{stop_id:5,partner_id:7}}];
 assert.equal(duplicate(queue,6,7),queue[0]);
 assert.equal(duplicate(queue,6,8),undefined);
 assert.equal(duplicate([{...queue[0],status:'done'}],6,7),undefined);
});
test('legacy bare null open response is allowed only for lookup', () => {
 assert.equal(logic.parseCustomerDeactivationResponse(null,5,true),null);
 assert.throws(()=>logic.parseCustomerDeactivationResponse(null,5));
});
