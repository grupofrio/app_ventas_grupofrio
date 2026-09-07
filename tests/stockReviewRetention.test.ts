import test from 'node:test';
import assert from 'node:assert/strict';
import { protectedReviewIds, removeUnprotectedDead, markStockReview, retryStockReview } from '../src/services/stockReviewRetention.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';
const row = (id: string, extra: Partial<SyncQueueItem> = {}): SyncQueueItem => ({ id, type: 'sale_order', status: 'dead', payload: {}, created_at: 1, retries: 0, error_message: null, priority: 1, next_retry_at: null, ...extra });
test('stock rejection retains operation identity, payload and transitively dependent evidence', () => {
 const queue = [row('sale',{status:'syncing',payload:{operation_id:'sale'}}),row('photo',{type:'photo',dependsOn:['sale']}),row('child',{type:'photo',dependsOn:['photo']}),row('old')];
 const marked=markStockReview(queue,'sale','Sin inventario');
 assert.equal(marked[0].payload.operation_id,'sale'); assert.equal(marked[0].status,'dead');
 assert.deepEqual([...protectedReviewIds(marked)],['sale','photo','child']);
 assert.deepEqual(removeUnprotectedDead(marked).map(i=>i.id),['sale','photo','child']);
 assert.deepEqual(removeUnprotectedDead(marked,['sale','photo','child','old']).map(i=>i.id),['sale','photo','child']);
});
test('preserves physical review and active queue rows during selective cleanup',()=>{
 const queue=[row('physical',{payload:{_consignmentPhysicalDeliveryReviewRequired:true}}),row('proof',{type:'photo',dependsOn:['physical']}),row('live',{status:'pending'}),row('old')];
 assert.deepEqual(removeUnprotectedDead(queue,['physical','proof','live','old']).map(i=>i.id),['physical','proof','live']);
});
test('retry keeps the same operation and rearms evidence only for a protected sale',()=>{
 const queue=markStockReview([row('sale'),row('proof',{type:'photo',dependsOn:['sale']}),row('other')],'sale','Stock');
 const retried=retryStockReview(queue,'sale'); assert.equal(retried[0].id,'sale'); assert.equal(retried[0].status,'pending'); assert.equal(retried[1].status,'pending');assert.equal(retried[2].status,'dead');
 assert.deepEqual(retryStockReview(queue,'other'),queue);
});
test('cleanup recognizes legacy explicit insufficient stock errors',()=>{
 const queue=[row('sale',{error_message:'insufficient_stock'})]; assert.equal(removeUnprotectedDead(queue).length,1);
});
test('stock retry leaves independent physical review and its evidence untouched',()=>{
 const queue=markStockReview([row('sale'),row('physical',{type:'consignment_create',dependsOn:['sale'],payload:{_consignmentPhysicalDeliveryReviewRequired:true}}),row('proof',{type:'photo',dependsOn:['physical']})],'sale','Stock');
 const retried=retryStockReview(queue,'sale');
 assert.equal(retried[0].status,'pending');assert.equal(retried[1].status,'dead');assert.equal(retried[2].status,'dead');
});
