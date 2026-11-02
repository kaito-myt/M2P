import test from 'node:test';
import assert from 'node:assert/strict';
import {readAfterV2ProducerCheck} from './v2-producer-cloud-inputs.mjs';

test('async stop rejection settles before any private read starts',async()=>{
  let reads=0,unhandled=[];
  const onUnhandled=error=>unhandled.push(error);process.on('unhandledRejection',onUnhandled);
  try{
    await assert.rejects(()=>readAfterV2ProducerCheck(async()=>{await Promise.resolve();throw Error('stop_requested');},async()=>{reads++;return Buffer.from('private');}),/stop_requested/);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,0);assert.deepEqual(unhandled,[]);
  }finally{process.off('unhandledRejection',onUnhandled);}
});

test('read begins only after the asynchronous pre-read check resolves',async()=>{
  const events=[];const value=await readAfterV2ProducerCheck(async()=>{await Promise.resolve();events.push('checked');},async()=>{events.push('read');return 'ok';});
  assert.equal(value,'ok');assert.deepEqual(events,['checked','read','checked']);
});

test('stop raised during private read withholds the bytes from the caller',async()=>{
  let checks=0;const bytes=Buffer.from('private');
  await assert.rejects(()=>readAfterV2ProducerCheck(async()=>{if(++checks===2)throw Error('stop_during_read');},async()=>bytes),/stop_during_read/);
  assert.equal(checks,2);
});
