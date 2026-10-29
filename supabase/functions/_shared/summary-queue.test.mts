// Run: node --experimental-strip-types --test supabase/functions/_shared/summary-queue.test.mts
// Logic tests over an in-memory fake store (NOT a Postgres proof; SQL semantics are proven separately in PGlite).
import test from "node:test"; import assert from "node:assert/strict";
import { tick, finalizeOpen, planFor, parseSummary, SUMMARY_ROUTE, ORPHAN_AFTER_MS, type SummaryStore } from "./summary-queue.ts";
const U = "u1";
function fake(n: number) {
  const cards = new Map<string, any>();
  for (let i = 0; i < n; i++) cards.set("c" + i, { id: "c" + i, user_id: U, title: "Real title " + i, source_url: "s", original_text: "body " + i, summary_custom_question: null, state: "pending", job: null, attempts: 0, hash: null, summary: null, updated: new Date().toISOString() });
  const jobs = new Map<string, any>(); const enq: any[] = []; let failEnqueue = false;
  const store: SummaryStore = {
    async tenantsWithPending() { return [...new Set([...cards.values()].filter((c) => c.state === "pending").map((c) => c.user_id))]; },
    async pendingCards(_u, l) { return [...cards.values()].filter((c) => c.state === "pending" && c.attempts < 3).slice(0, l); },
    async openRefs() { return [...cards.values()].filter((c) => c.state === "queued").map((c) => ({ cardId: c.id, userId: c.user_id, jobId: c.job, updatedAt: c.updated })); },
    async getCard(_u, id) { return cards.get(id) ?? null; },
    async questionsFor() { return ["q1"]; },
    async getJob(id) { return jobs.get(id) ?? null; },
    async reserve(_u, id, j, h) { const open = [...cards.values()].filter((c) => c.state === "queued").length; const c = cards.get(id); if (open >= 5 || !c || c.state !== "pending" || c.attempts >= 3) return false; c.state = "queued"; c.job = j; c.hash = h; return true; },
    async apply(a) { const c = cards.get(a.cardId); if (!c || c.state !== "queued" || c.job !== a.jobId || c.hash !== a.hash || c.user_id !== a.userId) return false; c.state = "done"; c.summary = a.summary; return true; },
    async release(_u, id, j) { const c = cards.get(id); if (!c || c.state !== "queued" || c.job !== j) return null; c.attempts++; c.state = c.attempts >= 3 ? "failed" : "pending"; c.job = null; c.hash = null; return c.state; },
    async unreserve(_u, id, j) { const c = cards.get(id); if (!c || c.state !== "queued" || c.job !== j) return false; c.state = "pending"; c.job = null; c.hash = null; return true; },
    async enqueue({ cardId, jobId, hash }) { if (failEnqueue) throw new Error("boom"); enq.push({ cardId, jobId, hash }); jobs.set(jobId, { id: jobId, user_id: U, route: SUMMARY_ROUTE, status: "queued", result: null, last_error: null, input_snapshot: { context: { cardId, hash } } }); },
  };
  return { store, cards, jobs, enq, setFail: (v: boolean) => { failEnqueue = v; } };
}
const done = (f: any, j: string, text: string) => { const x = f.jobs.get(j); x.status = "completed"; x.result = { text }; };
const good = JSON.stringify({ summary: "S", answers: { q1: "A" } });

test("tick enqueues at most 3 cards per tenant per tick; a second tick before completion enqueues nothing for queued cards (no repeat enqueue)", async () => {
  const f = fake(5); const r1 = await tick(f.store); assert.equal(r1.enqueued, 3);
  const r2 = await tick(f.store); assert.equal(r2.enqueued, 2); assert.equal(r2.pending, 3); assert.equal(f.enq.length, 5);
  const r3 = await tick(f.store); assert.equal(r3.enqueued, 0); assert.equal(f.enq.length, 5);
});
test("DB-style tenant open cap of 5 holds", async () => {
  const f = fake(8); await tick(f.store); await tick(f.store); const r = await tick(f.store); assert.equal(f.enq.length, 5); assert.equal(r.enqueued, 0);
});
test("completed job with matching hash is applied once; later ticks do not re-enqueue (hash+jobId key has no time bucket)", async () => {
  const f = fake(1); await tick(f.store); done(f, f.enq[0].jobId, good);
  const r = await tick(f.store); assert.equal(r.applied, 1); assert.equal(f.cards.get("c0").state, "done");
  for (let i = 0; i < 3; i++) await tick(f.store); assert.equal(f.enq.length, 1);
});
test("card text changed after enqueue: result NOT applied, released (attempt counted), re-enqueued with the new hash", async () => {
  const f = fake(1); await tick(f.store); const old = f.enq[0]; f.cards.get("c0").original_text = "edited body";
  done(f, old.jobId, good); const r = await tick(f.store);
  assert.equal(r.applied, 0); assert.equal(r.stale, 1); assert.equal(f.cards.get("c0").summary, null);
  assert.equal(f.enq.length, 2); assert.notEqual(f.enq[1].hash, old.hash); assert.equal(f.cards.get("c0").attempts, 1);
});
test("job for a different card/tenant or wrong route is never applied", async () => {
  const f = fake(1); await tick(f.store); const j = f.jobs.get(f.enq[0].jobId); j.input_snapshot.context.cardId = "other"; done(f, f.enq[0].jobId, good);
  const r = await finalizeOpen(f.store, null); assert.equal(r.applied, 0); assert.equal(r.errors.length, 1); assert.equal(f.cards.get("c0").state, "queued");
  j.input_snapshot.context.cardId = "c0"; j.user_id = "u2"; const r2 = await finalizeOpen(f.store, null); assert.equal(r2.applied, 0); assert.equal(r2.errors.length, 1);
});
test("unparseable / failed results release with attempts counted; 3 attempts -> failed and never re-enqueued", async () => {
  const f = fake(1);
  for (let i = 0; i < 3; i++) { await tick(f.store); const j = f.enq[i].jobId; done(f, j, "not json"); await finalizeOpen(f.store, null); }
  const c = f.cards.get("c0"); assert.equal(c.state, "failed"); assert.equal(c.attempts, 3);
  const n = f.enq.length; await tick(f.store); assert.equal(f.enq.length, n);
});
test("enqueue failure unreserves without burning an attempt; orphan reservation (no job) is unreserved only after the orphan window", async () => {
  const f = fake(1); f.setFail(true); const r = await tick(f.store); assert.equal(r.errors.length, 1); assert.equal(f.cards.get("c0").state, "pending"); assert.equal(f.cards.get("c0").attempts, 0);
  const c = f.cards.get("c0"); c.state = "queued"; c.job = "ghost"; c.updated = new Date().toISOString();
  const a = await finalizeOpen(f.store, null); assert.equal(a.pending, 1); assert.equal(c.state, "queued");
  const b = await finalizeOpen(f.store, null, Date.now() + ORPHAN_AFTER_MS + 1000); assert.equal(b.unreserved, 1); assert.equal(c.state, "pending");
});
test("custom question: prompt carries only that question and the hash differs from the general plan", async () => {
  const f = fake(1); const card = f.cards.get("c0"); const p1 = await planFor(f.store, card); card.summary_custom_question = "Why?"; const p2 = await planFor(f.store, card);
  assert.notEqual(p1.hash, p2.hash); assert.ok(p2.prompt.includes("1. Why?")); assert.equal(p2.generateTitle, false);
});
test("parseSummary validates untrusted output", () => {
  assert.equal(parseSummary("nope", ["q1"], null), null); assert.equal(parseSummary('{"summary":"","answers":{}}', ["q1"], null), null);
  const ok = parseSummary("```json\n" + good + "\n```", ["q1"], null); assert.deepEqual(ok?.answers, { q1: "A" });
  assert.deepEqual(parseSummary('{"summary":"S","answers":{"q1":5,"zz":"x"}}', ["q1"], null)?.answers, {});
});
