// Tests for the CreateContent durable generation handle. Run: node --test src/lib/createContentRecovery.test.mts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindGenerationJob,
  buildPendingHandle as pending,
  classifyAdmissionError as classifyAdmission,
  classifyCreateContentError as classify,
  createContentHandleKey as key,
  finalRunErrorAction,
  interpretConsumeResult as consume,
  invokeInputFields,
  isBoundHandle,
  isLegacyHandle,
  isPendingHandle,
  isTerminalHandle,
  markHandleTerminal as terminal,
  mintRequestKey,
  parseInputMismatch,
  parseFailedReplay,
  readCreateContentHandle as read,
  readInvokeErrorBody,
  reconcileAction,
  sameDirection,
  sameInputs,
  writeCreateContentHandle as write,
} from './createContentRecovery.ts';

const UID_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const UID_B = 'bbbbbbbb-1111-4222-8333-444444444444';
const JOB = '123e4567-e89b-42d3-a456-426614174000';
const JOB2 = '123e4567-e89b-42d3-a456-426614174001';
const KEY = 'ffffffff-1111-4222-8333-555555555555';
const KEY2 = 'ffffffff-1111-4222-8333-666666666666';
const DRAFT = 'dddddddd-1111-4222-8333-777777777777';

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
    keys: () => [...m.keys()],
  };
};
const throwingStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
};

const httpError = (status, body) => Object.assign(new Error(`Edge Function returned a non-2xx status code`), {
  context: { status, json: async () => body },
});

// ---------- v2 pending/bound lifecycle ----------

test('v2 round-trip: pending handle (requestKey, no job) survives write+read', () => {
  const s = memStorage();
  const h = pending(UID_A, 'directions', KEY, inputs());
  write(s, UID_A, h);
  const got = read(s, UID_A);
  assert.deepEqual(got, JSON.parse(JSON.stringify(h)));
  assert.ok(isPendingHandle(got));
  assert.ok(!isBoundHandle(got));
  assert.equal(got.requestKey, KEY);
});

test('v2 round-trip: binding a generation job keeps key, inputs, direction', () => {
  const s = memStorage();
  const h = bindGenerationJob(
    pending(UID_A, 'final', KEY, inputs({ insightCardIds: ['c1'] }), { direction: dir('Chosen'), directions: [dir('A')] }),
    JOB,
  );
  write(s, UID_A, h);
  const got = read(s, UID_A);
  assert.deepEqual(got, JSON.parse(JSON.stringify(h)));
  assert.ok(isBoundHandle(got));
  assert.equal(got.generationJobId, JOB);
  assert.equal(got.requestKey, KEY);
  assert.equal(got.direction.title, 'Chosen');
});

test('v1 legacy handle: stored jobId reads as generationJobId, poll-only', () => {
  const s = memStorage();
  s.setRaw(key(UID_A), JSON.stringify({ version: 1, uid: UID_A, phase: 'directions', jobId: JOB, inputs: inputs(), updatedAt: new Date(0).toISOString() }));
  const got = read(s, UID_A);
  assert.ok(isLegacyHandle(got));
  assert.ok(isBoundHandle(got));
  assert.equal(got.generationJobId, JOB);
  assert.equal(got.requestKey, undefined);
  assert.equal(reconcileAction(got), 'poll'); // v1 never re-invokes
});

test('reconcileAction: terminal -> none, bound -> poll, pending -> reattach', () => {
  const p = pending(UID_A, 'directions', KEY, inputs());
  assert.equal(reconcileAction(p), 'reattach');
  assert.equal(reconcileAction(bindGenerationJob(p, JOB)), 'poll');
  assert.equal(reconcileAction(terminal(p, 'worker job failed')), 'none'); // never auto re-admit (G2)
});

test('terminal handle: retained with inputs + reason, never auto-resumed', () => {
  const s = memStorage();
  const h = terminal(bindGenerationJob(pending(UID_A, 'final', KEY, inputs({ seedInsight: 'kept' }), { direction: dir() }), JOB), 'The generation failed.');
  write(s, UID_A, h);
  const got = read(s, UID_A);
  assert.ok(isTerminalHandle(got));
  assert.equal(got.terminalReason, 'The generation failed.');
  assert.equal(got.inputs.seedInsight, 'kept'); // inputs survive a reload
  assert.equal(reconcileAction(got), 'none');
});

test('mintRequestKey: fresh keys differ and are UUID-shaped', () => {
  const a = mintRequestKey();
  const b = mintRequestKey();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

// ---------- storage safety / owner binding ----------

test('owner binding: another uid cannot read the handle, entry untouched', () => {
  const s = memStorage();
  write(s, UID_A, pending(UID_A, 'directions', KEY, inputs()));
  assert.equal(read(s, UID_B), null);
  assert.ok(s.has(key(UID_A)), "A's entry must not be clobbered by B's read");
});

test('owner binding: uid inside the payload must match the key owner', () => {
  const s = memStorage();
  const foreign = pending(UID_B, 'directions', KEY, inputs());
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
    { version: 3, uid: UID_A, phase: 'directions', requestKey: KEY, inputs: inputs() },
    { version: 2, uid: UID_A, phase: 'sideways', requestKey: KEY, inputs: inputs() },
    { version: 2, uid: UID_A, phase: 'directions', inputs: inputs() },              // v2 without requestKey
    { version: 2, uid: UID_A, phase: 'directions', requestKey: KEY, generationJobId: 'not-a-uuid', inputs: inputs() },
    { version: 1, uid: UID_A, phase: 'directions', jobId: 'not-a-uuid', inputs: inputs() },
    { version: 1, uid: UID_A, phase: 'directions', inputs: inputs() },              // v1 without jobId
    { version: 2, uid: UID_A, phase: 'directions', requestKey: KEY },               // no inputs
    { version: 2, uid: UID_A, phase: 'directions', requestKey: KEY, inputs: { seedCategory: 'thesis' } },
  ]) {
    const s = memStorage();
    s.setRaw(key(UID_A), JSON.stringify(bad));
    assert.equal(read(s, UID_A), null, JSON.stringify(bad));
    assert.equal(s.has(key(UID_A)), false, 'rejected entry is removed');
  }
});

test('a final-phase handle without its direction cannot resume: rejected', () => {
  const s = memStorage();
  s.setRaw(key(UID_A), JSON.stringify({ version: 2, uid: UID_A, phase: 'final', requestKey: KEY, inputs: inputs() }));
  assert.equal(read(s, UID_A), null);
});

test('write(null) clears; empty uid is a no-op', () => {
  const s = memStorage();
  write(s, UID_A, pending(UID_A, 'directions', KEY, inputs()));
  write(s, UID_A, null);
  assert.equal(read(s, UID_A), null);
  write(s, UID_A, pending(UID_A, 'directions', KEY, inputs())); // must not throw or write
  assert.equal(s.has(key('')), false);
});

test('non-string insight card ids are filtered out, not fatal', () => {
  const s = memStorage();
  const h = pending(UID_A, 'directions', KEY, inputs());
  const raw = JSON.parse(JSON.stringify(h));
  raw.inputs.insightCardIds = ['c1', 7, null, 'c2'];
  s.setRaw(key(UID_A), JSON.stringify(raw));
  assert.deepEqual(read(s, UID_A).inputs.insightCardIds, ['c1', 'c2']);
});

test('unavailable storage (private mode) degrades to no recovery, never throws', () => {
  assert.equal(read(throwingStorage, UID_A), null);
  write(throwingStorage, UID_A, pending(UID_A, 'directions', KEY, inputs()));
  write(throwingStorage, UID_A, null);
});

test('two runs for one user: the latest write wins (single in-flight slot)', () => {
  const s = memStorage();
  write(s, UID_A, pending(UID_A, 'directions', KEY, inputs()));
  write(s, UID_A, pending(UID_A, 'final', KEY2, inputs(), { direction: dir() }));
  const got = read(s, UID_A);
  assert.equal(got.phase, 'final');
  assert.equal(got.requestKey, KEY2);
});

// ---------- input comparison / wire shape ----------

test('sameInputs: equal including order-insensitive insight cards', () => {
  const a = inputs({ insightCardIds: ['c1', 'c2'], formatId: 'f1' });
  const b = inputs({ insightCardIds: ['c2', 'c1'], formatId: 'f1' });
  assert.ok(sameInputs(a, b));
  assert.ok(!sameInputs(a, inputs({ seedInsight: 'edited' })));
  assert.ok(!sameInputs(a, inputs({ formatId: null }))); // set vs unset matters
  assert.ok(!sameInputs(a, inputs({ insightCardIds: ['c1'], formatId: 'f1' })));
});

test('sameInputs: strategyJobId participates (content-relevant, v4 amendment)', () => {
  const a = inputs({ strategyJobId: 'job-a' });
  assert.ok(sameInputs(a, inputs({ strategyJobId: 'job-a' })));
  assert.ok(!sameInputs(a, inputs({ strategyJobId: 'job-b' })));
  assert.ok(!sameInputs(a, inputs({ strategyJobId: null }))); // set vs unset matters
});

test('sameDirection: full-field equality, undefined-safe', () => {
  assert.ok(sameDirection(dir('X'), dir('X')));
  assert.ok(!sameDirection(dir('X'), dir('Y')));
  assert.ok(!sameDirection(undefined, dir('X')));
  assert.ok(!sameDirection(dir('X'), undefined));
  assert.ok(!sameDirection({ title: 'X', description: 'other', angle: 'a' }, dir('X')));
});

test('invokeInputFields: unset strategy selections are OMITTED, strategy job rides the legacy jobId wire field', () => {
  const unset = invokeInputFields(inputs());
  assert.equal(unset.formatId, undefined);
  assert.equal(unset.natureId, undefined);
  assert.equal(unset.jobId, undefined);
  // undefined drops from JSON: the wire body omits unset selections entirely.
  assert.deepEqual(JSON.parse(JSON.stringify(unset)), { seedInsight: 'Seed thought', seedCategory: 'thesis' });
  const set = invokeInputFields(inputs({ formatId: 'f1', natureId: 'n1', strategyJobId: 'sj1' }));
  assert.deepEqual(set, { seedInsight: 'Seed thought', seedCategory: 'thesis', formatId: 'f1', natureId: 'n1', jobId: 'sj1' });
});

// ---------- error classification ----------

test('classify (bound phase): stillRunning is transient (keep handle), everything else terminal', () => {
  const e = Object.assign(new Error('Job status is temporarily unavailable.'), { stillRunning: true });
  assert.equal(classify(e), 'transient');
  assert.equal(classify(new Error('That job is no longer available.')), 'terminal');
  assert.equal(classify(new Error('worker job failed')), 'terminal');
  assert.equal(classify(null), 'terminal');
  assert.equal(classify(undefined), 'terminal');
  assert.equal(classify({}), 'terminal');
});

test('admission: 400 clears a FRESH admission but RETAINS on reattach', () => {
  const bad = httpError(400, { error: 'seedInsight required' });
  assert.equal(classifyAdmission(bad, { reattach: false }), 'clear');
  assert.equal(classifyAdmission(bad, { reattach: true }), 'retain');
});

test('admission: 401/429/5xx/network all RETAIN the pending key', () => {
  for (const e of [httpError(401, {}), httpError(429, {}), httpError(503, {}), new TypeError('fetch failed'), new Error('unknown')]) {
    assert.equal(classifyAdmission(e, { reattach: false }), 'retain', String(e));
    assert.equal(classifyAdmission(e, { reattach: true }), 'retain', String(e));
  }
});

test('finalRunErrorAction: transient keeps the handle; terminal surfaces and stays on BOTH fresh and resumed runs', () => {
  const e = Object.assign(new Error('Job status is temporarily unavailable.'), { stillRunning: true });
  assert.deepEqual(finalRunErrorAction(e), { kind: 'keep-handle' });
  // No silent placeholder draft is ever substituted (contract: no legacy
  // direct-insert fallback) - fresh interactive clicks included.
  assert.deepEqual(finalRunErrorAction(new Error('worker job failed')), { kind: 'surface-and-stay' });
  assert.deepEqual(finalRunErrorAction(new Error('That job is no longer available.')), { kind: 'surface-and-stay' });
});

// ---------- 409 INPUT_MISMATCH ----------

test('parseInputMismatch: 409 + code carries the existing generation job id', () => {
  assert.deepEqual(parseInputMismatch(409, { code: 'INPUT_MISMATCH', jobId: JOB }), { existingGenerationJobId: JOB });
  assert.deepEqual(parseInputMismatch(409, { error: 'INPUT_MISMATCH', jobId: JOB }), { existingGenerationJobId: JOB });
  assert.deepEqual(parseInputMismatch(409, { code: 'INPUT_MISMATCH' }), { existingGenerationJobId: null });
  assert.equal(parseInputMismatch(409, { code: 'OTHER' }), null);
  assert.equal(parseInputMismatch(404, { code: 'INPUT_MISMATCH', jobId: JOB }), null);
  assert.equal(parseInputMismatch(409, null), null);
});

test('readInvokeErrorBody: parses the error context body, never throws', async () => {
  assert.deepEqual(await readInvokeErrorBody(httpError(409, { code: 'INPUT_MISMATCH', jobId: JOB })), { code: 'INPUT_MISMATCH', jobId: JOB });
  assert.equal(await readInvokeErrorBody(new Error('network')), null);
  const broken = Object.assign(new Error('x'), { context: { json: async () => { throw new Error('bad json'); } } });
  assert.equal(await readInvokeErrorBody(broken), null);
});

// ---------- consume-final-job interpretation (contract G4) ----------

test('consume 200: branch on the created field, not the status code', () => {
  assert.deepEqual(consume(200, { draftId: DRAFT, created: true }), { kind: 'created', draftId: DRAFT });
  assert.deepEqual(consume(200, { draftId: DRAFT, created: false }), { kind: 'reattached', draftId: DRAFT });
});

test('consume 200 with a missing created flag biases to silent (at-most-once notification)', () => {
  assert.deepEqual(consume(200, { draftId: DRAFT }), { kind: 'reattached', draftId: DRAFT });
});

test('consume 200 without a draftId is transient, never a silent success', () => {
  assert.equal(consume(200, {}).kind, 'transient');
  assert.equal(consume(200, null).kind, 'transient');
});

test('consume 409: reason pending is try-later (incl paused_auth/paused_quota), reason failed is terminal', () => {
  assert.deepEqual(consume(409, { reason: 'pending' }), { kind: 'pending' });
  assert.equal(consume(409, { reason: 'failed' }).kind, 'terminal');
  assert.equal(consume(409, {}).kind, 'terminal'); // unknown 409 reason: do not keep retrying forever
});

test('consume 404 and 422 are terminal with reasons', () => {
  assert.deepEqual(consume(404, {}), { kind: 'terminal', reason: 'That job is no longer available.' });
  assert.deepEqual(consume(422, { error: 'LEGACY_CONTENT_UNDERIVABLE' }), { kind: 'terminal', reason: 'The generated content could not be recovered.' });
});

test('consume 401/429/5xx/network are transient (the draft may still be creatable)', () => {
  for (const status of [0, 401, 429, 500, 503]) {
    assert.equal(consume(status, {}).kind, 'transient', `status ${status}`);
  }
});

// ---------- multi-tab identity-conditional writes + server-body messages ----------
import {
  clearCreateContentHandleForRun as clearForRun,
  writeCreateContentHandleForRun as writeForRun,
  createContentRunKey as runKey,
  invokeErrorMessage,
  isSameRun,
  listCreateContentHandles as list,
  readRunHandle as readRun,
  runIdentityOf,
} from './createContentRecovery.ts';

test('runIdentityOf: requestKey for v2 (stable pending->bound), generationJobId for legacy v1', () => {
  const p = pending(UID_A, 'directions', KEY, inputs());
  assert.equal(runIdentityOf(p), KEY);
  assert.equal(runIdentityOf(bindGenerationJob(p, JOB)), KEY); // binding does not change identity
  const s = memStorage();
  s.setRaw(key(UID_A), JSON.stringify({ version: 1, uid: UID_A, phase: 'directions', jobId: JOB, inputs: inputs(), updatedAt: new Date(0).toISOString() }));
  assert.equal(runIdentityOf(read(s, UID_A)), JOB);
});

test('isSameRun: same key across pending/bound; different keys or jobs are different runs', () => {
  const a = pending(UID_A, 'directions', KEY, inputs());
  assert.ok(isSameRun(a, bindGenerationJob(a, JOB)));
  assert.ok(!isSameRun(a, pending(UID_A, 'directions', KEY2, inputs())));
});

test('multi-tab: concurrent runs live in separate slots; a run finishing clears ONLY its own', () => {
  const s = memStorage();
  // Tab 1 run A (older) and tab 2 run B (newer) in flight at once.
  assert.equal(writeForRun(s, UID_A, KEY, pending(UID_A, 'directions', KEY, inputs())), true);
  assert.equal(writeForRun(s, UID_A, KEY2, pending(UID_A, 'final', KEY2, inputs(), { direction: dir() })), true);
  // Run A completes and clears: run B's slot is a different key - untouched by construction.
  assert.equal(clearForRun(s, UID_A, KEY), true);
  assert.equal(readRun(s, UID_A, KEY), null);
  assert.equal(readRun(s, UID_A, KEY2)?.requestKey, KEY2, 'newer run B handle survives');
});

test('conditional clear: only the run\'s own slot is removed; empty identity never clears', () => {
  const s = memStorage();
  writeForRun(s, UID_A, KEY, pending(UID_A, 'directions', KEY, inputs()));
  assert.equal(clearForRun(s, UID_A, ''), false);
  assert.equal(clearForRun(s, UID_A, KEY2), true); // absent slot: no-op, run A untouched
  assert.ok(readRun(s, UID_A, KEY));
  assert.equal(clearForRun(s, UID_A, KEY), true);
  assert.equal(readRun(s, UID_A, KEY), null);
});

test('conditional write: identity/handle mismatch refused; own-slot writes land', () => {
  const s = memStorage();
  writeForRun(s, UID_A, KEY2, pending(UID_A, 'directions', KEY2, inputs())); // run B
  const boundA = bindGenerationJob(pending(UID_A, 'directions', KEY, inputs()), JOB);
  assert.equal(writeForRun(s, UID_A, KEY2, boundA), false); // run A's handle into run B's slot: refused
  const cur = readRun(s, UID_A, KEY2);
  assert.equal(cur.requestKey, KEY2);
  assert.equal(cur.generationJobId, undefined, 'run B untouched');
  assert.equal(writeForRun(s, UID_A, KEY2, bindGenerationJob(cur, JOB2)), true);
  assert.equal(readRun(s, UID_A, KEY2).generationJobId, JOB2);
});

test('per-run write on legacy v1 identity (generationJobId) round-trips terminal', () => {
  const s = memStorage();
  s.setRaw(key(UID_A), JSON.stringify({ version: 1, uid: UID_A, phase: 'directions', jobId: JOB, inputs: inputs(), updatedAt: new Date(0).toISOString() }));
  const cur = read(s, UID_A); // legacy single-slot read
  assert.equal(writeForRun(s, UID_A, JOB, terminal(cur, 'gone')), true);
  assert.ok(isTerminalHandle(readRun(s, UID_A, JOB)));
});

test('list: migrates the legacy single slot after a VERIFIED per-run write, then removes it', () => {
  const s = memStorage();
  const legacyJson = JSON.stringify({ version: 1, uid: UID_A, phase: 'directions', jobId: JOB, inputs: inputs(), updatedAt: new Date(0).toISOString() });
  s.setRaw(key(UID_A), legacyJson);
  writeForRun(s, UID_A, KEY, pending(UID_A, 'directions', KEY, inputs()));
  const runs = list(s, UID_A);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].requestKey, KEY, 'newest first');
  assert.equal(runs[1].generationJobId, JOB);
  assert.equal(s.raw(key(UID_A)), undefined, 'legacy slot removed after verified migration');
  assert.ok(JSON.parse(s.raw(runKey(UID_A, JOB))), 'per-run slot holds the migrated run');
});

test('list: migration NEVER deletes the legacy slot when the per-run write fails', () => {
  const legacyJson = JSON.stringify({ version: 1, uid: UID_A, phase: 'directions', jobId: JOB, inputs: inputs(), updatedAt: new Date(0).toISOString() });
  let removed = false;
  const s = {
    getItem: (k) => (k === key(UID_A) ? legacyJson : null),
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { removed = true; },
    keys: () => [],
  };
  const runs = list(s, UID_A);
  assert.equal(runs.length, 0, 'unmigratable legacy handle is not duplicated into the list');
  assert.equal(removed, false, 'legacy slot kept on failed per-run write');
});

test('list: migration keeps the legacy slot when the per-run read-back is not byte-equal', () => {
  const legacyJson = JSON.stringify({ version: 1, uid: UID_A, phase: 'directions', jobId: JOB, inputs: inputs(), updatedAt: new Date(0).toISOString() });
  const written = new Map();
  const removedKeys = [];
  const s = {
    getItem: (k) => (k === key(UID_A) ? legacyJson : written.has(k) ? written.get(k) + ' ' : null), // corrupting read-back
    setItem: (k, v) => void written.set(k, v),
    removeItem: (k) => void removedKeys.push(k),
    keys: () => [...written.keys()],
  };
  list(s, UID_A);
  assert.ok(!removedKeys.includes(key(UID_A)), 'legacy slot kept on byte-mismatched read-back');
});

test('list: migration never overwrites an existing per-run slot (terminal survives a stale legacy entry)', () => {
  const s = memStorage();
  const term = terminal(pending(UID_A, 'directions', KEY, inputs()), 'failed');
  writeForRun(s, UID_A, KEY, term);
  // Stale pre-migration copy of the SAME run, still active (e.g. written by
  // an older tab before the terminal mark landed):
  s.setRaw(key(UID_A), JSON.stringify({ version: 2, uid: UID_A, phase: 'directions', status: 'active', requestKey: KEY, inputs: inputs(), updatedAt: new Date(0).toISOString() }));
  const runs = list(s, UID_A);
  assert.equal(runs.length, 1);
  assert.ok(isTerminalHandle(runs[0]), 'terminal per-run slot survives migration');
  assert.equal(s.raw(key(UID_A)), undefined, 'stale legacy entry removed');
});

test('list: runs from other accounts are excluded; corrupt slots are dropped', () => {
  const s = memStorage();
  writeForRun(s, UID_A, KEY, pending(UID_A, 'directions', KEY, inputs()));
  writeForRun(s, UID_B, KEY2, pending(UID_B, 'directions', KEY2, inputs()));
  s.setRaw(runKey(UID_A, 'garbage'), '{not json');
  const runs = list(s, UID_A);
  assert.deepEqual(runs.map((r) => r.requestKey), [KEY]);
  assert.equal(s.raw(runKey(UID_A, 'garbage')), undefined);
  assert.deepEqual(list(s, UID_B).map((r) => r.requestKey), [KEY2]);
});

test('list: no expiry or pruning - old terminal runs stay discoverable until dismissed', () => {
  const s = memStorage();
  const ancient = terminal(pending(UID_A, 'directions', KEY, inputs()), 'failed long ago');
  ancient.updatedAt = new Date('2020-01-01T00:00:00Z').toISOString();
  writeForRun(s, UID_A, KEY, ancient);
  const runs = list(s, UID_A);
  assert.equal(runs.length, 1);
  assert.ok(isTerminalHandle(runs[0]));
  assert.equal(runs[0].inputs.seedInsight, 'Seed thought', 'terminal inputs retained');
});

test('invokeErrorMessage: decoded body.error/body.message beat the SDK generic wrapper', () => {
  const sdk = (status, body) => Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: { status, json: async () => body } });
  assert.equal(invokeErrorMessage(sdk(429, { error: 'rate limited' }), { error: 'rate limited' }, 'fallback'), 'rate limited');
  assert.equal(invokeErrorMessage(sdk(400, { message: 'seedInsight required' }), { message: 'seedInsight required' }, 'fallback'), 'seedInsight required');
  assert.equal(invokeErrorMessage(sdk(500, {}), {}, 'fallback'), 'fallback'); // generic SDK text never surfaces
  assert.equal(invokeErrorMessage(new Error('worker job failed'), null, 'fallback'), 'worker job failed'); // real messages pass through
  assert.equal(invokeErrorMessage(null, null, 'fallback'), 'fallback');
});

test("parseFailedReplay: recognizes 409 reason failed with job identity", () => {
  const jobId = "11111111-2222-3333-4444-555555555555";
  const r = parseFailedReplay(409, { reason: "failed", jobId });
  assert.ok(r);
  assert.equal(r.failedGenerationJobId, jobId);
});

test("parseFailedReplay: tolerates missing jobId", () => {
  const r = parseFailedReplay(409, { reason: "failed" });
  assert.ok(r);
  assert.equal(r.failedGenerationJobId, null);
});

test("parseFailedReplay: INPUT_MISMATCH body is NOT a failed replay", () => {
  assert.equal(parseFailedReplay(409, { code: "INPUT_MISMATCH", reason: "failed", jobId: "x" }), null);
  assert.equal(parseFailedReplay(409, { error: "INPUT_MISMATCH", jobId: "x" }), null);
});

test("parseFailedReplay: pending / other statuses / null body rejected", () => {
  assert.equal(parseFailedReplay(409, { reason: "pending" }), null);
  assert.equal(parseFailedReplay(409, {}), null);
  assert.equal(parseFailedReplay(404, { reason: "failed" }), null);
  assert.equal(parseFailedReplay(409, null), null);
});

test("parseFailedReplay: exact executor contract body { error: 'JOB_FAILED', reason: 'failed', jobId }", () => {
  const jobId = "123e4567-e89b-42d3-a456-426614174007";
  const r = parseFailedReplay(409, { error: "JOB_FAILED", reason: "failed", jobId });
  assert.ok(r);
  assert.equal(r.failedGenerationJobId, jobId);
});
