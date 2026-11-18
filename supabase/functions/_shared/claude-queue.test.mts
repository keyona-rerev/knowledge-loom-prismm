// Run: node --experimental-strip-types --test supabase/functions/_shared/claude-queue.test.mts
// The subscription queue contract every interactive caller relies on:
// idempotent reattach, failed-job rotation, and noRotateFailed. Fake
// supabase with a unique request_id index; DISPATCHER_SECRET unset so no
// network call is made.
import test from "node:test"; import assert from "node:assert/strict";
(globalThis as any).Deno = { env: { get: (_k: string) => undefined } };
const { enqueueInteractiveJob } = await import("./claude-queue.ts");

function fakeSupabase() {
  const rows: any[] = []; let n = 0;
  const api = {
    rows,
    from(_t: string) {
      let filters: Array<(r: any) => boolean> = [];
      const q: any = {
        insert(row: any) {
          return { select: () => ({ single: async () => {
            if (rows.some((r) => r.request_id === row.request_id)) return { data: null, error: { message: "duplicate key", code: "23505" } };
            const r = { id: `job-${++n}`, ...row }; rows.push(r); return { data: { id: r.id }, error: null };
          } }) };
        },
        select(_c: string) { return q; },
        eq(k: string, v: any) { filters.push((r) => r[k] === v); return q; },
        or(expr: string) {
          const base = expr.match(/request_id\.eq\.(.+?),request_id\.like\./)![1];
          filters.push((r) => r.request_id === base || r.request_id.startsWith(`${base}:r`)); return q;
        },
        async maybeSingle() { const d = rows.filter((r) => filters.every((f) => f(r))); return { data: d[0] ?? null }; },
        then(res: any) { return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))) }).then(res); },
      };
      return q;
    },
  };
  return api;
}

const base = { userId: "u1", route: "generate-draft-visual", kind: "draft-visual", prompt: "p", system: "s", context: { visual_id: "v1" } };

test("first enqueue creates a queued interactive job with the snapshot", async () => {
  const sb = fakeSupabase();
  const h = await enqueueInteractiveJob(sb as any, { ...base, idempotencyKey: "visual:v1" });
  assert.equal(h.created, true);
  const row = sb.rows[0];
  assert.equal(row.status, "queued"); assert.equal(row.path, "interactive");
  assert.equal(row.input_snapshot.interactiveKind, "draft-visual");
  assert.deepEqual(row.input_snapshot.context, { visual_id: "v1" });
});

test("same key reattaches to the same job (no second worker run)", async () => {
  const sb = fakeSupabase();
  const a = await enqueueInteractiveJob(sb as any, { ...base, idempotencyKey: "visual:v1" });
  const b = await enqueueInteractiveJob(sb as any, { ...base, idempotencyKey: "visual:v1" });
  assert.equal(a.jobId, b.jobId); assert.equal(b.created, false); assert.equal(sb.rows.length, 1);
});

test("noRotateFailed: a failed job is handed back, never replayed", async () => {
  const sb = fakeSupabase();
  await enqueueInteractiveJob(sb as any, { ...base, idempotencyKey: "visual:v1", noRotateFailed: true });
  sb.rows[0].status = "failed";
  const h = await enqueueInteractiveJob(sb as any, { ...base, idempotencyKey: "visual:v1", noRotateFailed: true });
  assert.equal(h.failedLatest, true); assert.equal(sb.rows.length, 1);
});

test("default: a failed job rotates to a deterministic :r2 generation", async () => {
  const sb = fakeSupabase();
  await enqueueInteractiveJob(sb as any, { ...base, route: "revise-draft", idempotencyKey: "k" });
  sb.rows[0].status = "failed";
  const h = await enqueueInteractiveJob(sb as any, { ...base, route: "revise-draft", idempotencyKey: "k" });
  assert.equal(h.created, true); assert.match(h.requestId, /:r2$/); assert.equal(sb.rows.length, 2);
});
