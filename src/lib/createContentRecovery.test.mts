// Tests for the CreateContent durable job handle. Run: node --test src/lib/createContentRecovery.test.mts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreateContentHandle as build,
  classifyCreateContentError as classify,
  createContentHandleKey as key,
  readCreateContentHandle as read,
  sameDirection,
  sameInputs,
  writeCreateContentHandle as write,
} from './createContentRecovery.ts';

const UID_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const UID_B = 'bbbbbbbb-1111-4222-8333-444444444444';
const JOB = '123e4567-e89b-42d3-a456-426614174000';
const JOB2 = '123e4567-e89b-42d3-a456-426614174001';

const inputs = (over = {}) => ({
  seedInsight: 'Seed thought', seedCategory: 'thesis',
  formatId: null, natureId: null, strategyJobId: null,
  insightCardIds: [], ...over,
});
const dir = (t = 'T') => ({ title: t, description: 'd', angle: 'a' });

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    has: (k) => m.has(k),
    raw: (k) => m.get(k),
    setRaw: (k, v) => m.set(k, v),
  };
};
const throwingStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
};

test('round-trip: build + write + read returns the same handle', () => {
  const s = memStorage();
  const h = build(UID_A, 'directions', JOB, inputs());
  write(s, UID_A, h);
  // JSON storage drops undefined optional fields; compare against the stored shape.
  assert.deepEqual(read(s, UID_A), JSON.parse(JSON.stringify(h)));
});

test('round-trip: final phase keeps direction and directions list', () => {
  const s = memStorage();
  const h = build(UID_A, 'final', JOB, inputs({ insightCardIds: ['c1', 'c2'] }),
    { direction: dir('Chosen'), directions: [dir('A'), dir('B')] });
  write(s, UID_A, h);
  const got = read(s, UID_A);
  assert.deepEqual(got, h);
  assert.equal(got.directions.length, 2);
});

test('owner binding: another uid cannot read the handle, entry untouched', () => {
  const s = memStorage();
  write(s, UID_A, build(UID_A, 'directions', JOB, inputs()));
  assert.equal(read(s, UID_B), null);
  assert.ok(s.has(key(UID_A)), "A's entry must not be clobbered by B's read");
});

test('owner binding: uid inside the payload must match the key owner', () => {
  const s = memStorage();
  const foreign = build(UID_B, 'directions', JOB, inputs());
  s.setRaw(key(UID_A), JSON.stringify(foreign)); // tampered/misplaced entry
  assert.equal(read(s, UID_A), null);
  assert.ok(s.has(key(UID_A)), 'foreign handle is left in place, never resumed');
});

test('corrupt JSON is tolerated and removed', () => {
  const s = memStorage();
  s.setRaw(key(UID_A), '{not json');
  assert.equal(read(s, UID_A), null);
  assert.equal(s.has(key(UID_A)), false);
});

test('invalid shapes are rejected and removed', () => {
  for (const bad of [
    null, 42, 'x', {},
    { version: 2, uid: UID_A, phase: 'directions', jobId: JOB, inputs: inputs() },
    { version: 1, uid: UID_A, phase: 'sideways', jobId: JOB, inputs: inputs() },
    { version: 1, uid: UID_A, phase: 'directions', jobId: 'not-a-uuid', inputs: inputs() },
    { version: 1, uid: UID_A, phase: 'directions', jobId: JOB }, // no inputs
    { version: 1, uid: UID_A, phase: 'directions', jobId: JOB, inputs: { seedCategory: 'thesis' } },
  ]) {
    const s = memStorage();
    s.setRaw(key(UID_A), JSON.stringify(bad));
    assert.equal(read(s, UID_A), null, JSON.stringify(bad));
    assert.equal(s.has(key(UID_A)), false, 'rejected entry is removed');
  }
});

test('a final-phase handle without its direction cannot resume: rejected', () => {
  const s = memStorage();
  s.setRaw(key(UID_A), JSON.stringify({ version: 1, uid: UID_A, phase: 'final', jobId: JOB, inputs: inputs() }));
  assert.equal(read(s, UID_A), null);
});

test('write(null) clears; empty uid is a no-op', () => {
  const s = memStorage();
  write(s, UID_A, build(UID_A, 'directions', JOB, inputs()));
  write(s, UID_A, null);
  assert.equal(read(s, UID_A), null);
  write(s, '', build(UID_A, 'directions', JOB, inputs())); // must not throw or write
  assert.equal(s.has(key('')), false);
});

test('non-string insight card ids are filtered out, not fatal', () => {
  const s = memStorage();
  const h = build(UID_A, 'directions', JOB, inputs());
  const raw = JSON.parse(JSON.stringify(h));
  raw.inputs.insightCardIds = ['c1', 7, null, 'c2'];
  s.setRaw(key(UID_A), JSON.stringify(raw));
  assert.deepEqual(read(s, UID_A).inputs.insightCardIds, ['c1', 'c2']);
});

test('sameInputs: equal including order-insensitive insight cards', () => {
  const a = inputs({ insightCardIds: ['c1', 'c2'], formatId: 'f1' });
  const b = inputs({ insightCardIds: ['c2', 'c1'], formatId: 'f1' });
  assert.ok(sameInputs(a, b));
  assert.ok(!sameInputs(a, inputs({ seedInsight: 'edited' })));
  assert.ok(!sameInputs(a, inputs({ formatId: null }))); // set vs unset matters
  assert.ok(!sameInputs(a, inputs({ insightCardIds: ['c1'], formatId: 'f1' })));
});

test('sameDirection: full-field equality, undefined-safe', () => {
  assert.ok(sameDirection(dir('X'), dir('X')));
  assert.ok(!sameDirection(dir('X'), dir('Y')));
  assert.ok(!sameDirection(undefined, dir('X')));
  assert.ok(!sameDirection(dir('X'), undefined));
  assert.ok(!sameDirection({ title: 'X', description: 'other', angle: 'a' }, dir('X')));
});

test('classify: stillRunning is transient (keep handle), everything else terminal', () => {
  const e = Object.assign(new Error('Job status is temporarily unavailable.'), { stillRunning: true });
  assert.equal(classify(e), 'transient');
  assert.equal(classify(new Error('That job is no longer available.')), 'terminal');
  assert.equal(classify(new Error('worker job failed')), 'terminal');
  assert.equal(classify(null), 'terminal');
  assert.equal(classify(undefined), 'terminal');
  assert.equal(classify({}), 'terminal');
});

test('unavailable storage (private mode) degrades to no recovery, never throws', () => {
  assert.equal(read(throwingStorage, UID_A), null);
  write(throwingStorage, UID_A, build(UID_A, 'directions', JOB, inputs()));
  write(throwingStorage, UID_A, null);
});

test('two jobs for one user: the latest write wins (single in-flight slot)', () => {
  const s = memStorage();
  write(s, UID_A, build(UID_A, 'directions', JOB, inputs()));
  write(s, UID_A, build(UID_A, 'final', JOB2, inputs(), { direction: dir() }));
  const got = read(s, UID_A);
  assert.equal(got.phase, 'final');
  assert.equal(got.jobId, JOB2);
});

// Regression coverage for the reviewed flows: terminal failure on a resumed
// final run must surface-and-stay (never a silent placeholder draft), and the
// response-lost replay guard only matches the run's own earlier insert.
import { finalRunErrorAction } from './createContentRecovery.ts';

test('finalRunErrorAction: transient keeps the handle on both paths', () => {
  const e = Object.assign(new Error('Job status is temporarily unavailable.'), { stillRunning: true });
  assert.deepEqual(finalRunErrorAction(e, false), { kind: 'keep-handle' });
  assert.deepEqual(finalRunErrorAction(e, true), { kind: 'keep-handle' });
});

test('finalRunErrorAction: terminal on a RESUMED run surfaces and stays - no placeholder fallback', () => {
  assert.deepEqual(finalRunErrorAction(new Error('worker job failed'), true), { kind: 'surface-and-stay' });
  assert.deepEqual(finalRunErrorAction(new Error('That job is no longer available.'), true), { kind: 'surface-and-stay' });
});

test('finalRunErrorAction: terminal on a FRESH run keeps the pre-existing basic-draft fallback', () => {
  assert.deepEqual(finalRunErrorAction(new Error('Edge Function returned a non-2xx status code'), false), { kind: 'fallback-basic-draft' });
});

