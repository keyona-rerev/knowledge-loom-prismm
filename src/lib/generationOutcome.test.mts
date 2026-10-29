import test from 'node:test';import assert from 'node:assert/strict';import {generationOutcome as g} from './generationOutcome.ts';
test('queued is not generated',()=>assert.deepEqual(g({success:true,queued:true,jobId:'j'}),{kind:'queued',drafts:0,jobId:'j'}));
test('duplicate queued remains pending',()=>assert.equal(g({queued:true,duplicate:true,jobId:'j',jobStatus:'claimed'}).kind,'pending'));
test('duplicate failed not accepted',()=>assert.equal(g({queued:true,duplicate:true,jobId:'j',jobStatus:'failed'}).kind,'failed'));
test('duplicate completed does not invent count',()=>assert.deepEqual(g({queued:true,duplicate:true,jobId:'j',jobStatus:'completed'}),{kind:'completed',drafts:0,jobId:'j'}));
test('direct count and unknown',()=>{assert.equal(g({draftsCreated:2}).drafts,2);assert.equal(g({success:true}).kind,'unknown')});
