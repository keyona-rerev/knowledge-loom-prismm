// Run: node --experimental-strip-types --test supabase/functions/_shared/visual-enqueue.test.mts
// Queue-level tests for the subscription visual path: admission + enqueue on
// the app side, and the round trip through completeVisualJob with a real PNG.
// No network, no keys: fake Db, fake queue, a generated PNG.
import test from "node:test"; import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
(globalThis as any).Deno = { env: { get: (_k: string) => undefined } };
const { requestDraftVisual, requestVisualPreview, visualsEnabled, resolveVisualPlatform } = await import("./visual-enqueue.ts");
const { completeVisualJob } = await import("./visual-logic.ts");

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function fakeDb(drafts: Record<string, any>) {
  const visuals: Record<string, any> = {};
  const jobs: Record<string, any> = {};
  const uploads: string[] = [];
  let n = 0;
  return {
    visuals, jobs, uploads,
    async getDraft(id: string) { return drafts[id] ?? null; },
    async getProfileVisualConfig(_u: string) { return { business_name: "Acme", business_description: "Estate planning", visual_studio_config: null, visual_design_rules: null }; },
    async findGeneratingVisual(draftId: string) { return Object.values(visuals).find((v: any) => v.draft_id === draftId && v.status === "generating") ?? null; },
    async insertVisual(row: any) { const v = { id: `vis-${++n}`, ...row }; visuals[v.id] = v; return v; },
    async getVisual(id: string) { return visuals[id] ?? null; },
    async updateVisualWhere(id: string, filter: any, fields: any) {
      const v = visuals[id]; if (!v) return null;
      for (const [k, val] of Object.entries(filter)) if (v[k] !== val) return null;
      Object.assign(v, fields); return v;
    },
    async updateJobWhere(id: string, filter: any, fields: any) {
      const j = jobs[id]; if (!j) return null;
      for (const [k, val] of Object.entries(filter)) if (j[k] !== val) return null;
      Object.assign(j, fields); return j;
    },
    async uploadVisualPng(path: string, _b: Uint8Array) { uploads.push(path); return { url: `https://store.example/${path}` }; },
    async getDraftPublishState(_id: string) { return null; },
    async getAutomationConfig(_k: string) { return null; },
  } as any;
}

function fakeEnqueue() {
  const calls: any[] = [];
  const byKey: Record<string, string> = {};
  const fn = async (_db: any, args: any) => {
    calls.push(args);
    const key = args.idempotencyKey ? `interactive:${args.route}:${args.idempotencyKey}` : `one:${calls.length}`;
    if (byKey[key]) return { jobId: byKey[key], requestId: key, created: false };
    byKey[key] = `job-${calls.length}`;
    return { jobId: byKey[key], requestId: key, created: true };
  };
  return { fn, calls };
}

function png(w: number, h: number): string {
  const crcT = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[i] = c >>> 0; }
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

const DRAFT = { id: "d1", user_id: USER, title: "Wills are not enough", body: "A will goes through probate.", seed_insight: "Trusts avoid probate.", platform: "linkedin" };

test("switch: visuals are OFF unless VISUALS_ENABLED is exactly true", () => {
  assert.equal(visualsEnabled(() => undefined), false);
  assert.equal(visualsEnabled(() => "1"), false);
  assert.equal(visualsEnabled(() => " TRUE "), true);
});

test("platform: row value wins, then format, then default", () => {
  assert.equal(resolveVisualPlatform("instagram", "linkedin"), "instagram");
  assert.equal(resolveVisualPlatform("", "instagram"), "instagram");
  assert.equal(resolveVisualPlatform("twitter", "bogus"), "linkedin");
});

test("enqueue: one draft-visual job with the context the worker requires", async () => {
  const db = fakeDb({ d1: DRAFT }); const q = fakeEnqueue();
  const r = await requestDraftVisual(db, {} as any, q.fn, { authUserId: USER, draftId: "d1" });
  assert.equal(r.status, 202);
  assert.equal(q.calls.length, 1);
  const a = q.calls[0];
  assert.equal(a.kind, "draft-visual");
  assert.equal(a.route, "generate-draft-visual");
  assert.equal(a.noRotateFailed, true);
  // worker select-mode.py fails closed without these three
  assert.ok(a.context.visual_id && a.context.source_hash);
  assert.ok(Number.isInteger(a.context.canvas.w) && Number.isInteger(a.context.canvas.h));
  assert.equal(a.context.draft_id, "d1");
  assert.equal(a.context.platform, "linkedin");
  assert.match(a.prompt, /Wills are not enough/);
  assert.match(a.system, /no @import, no <link>, no url\(\)/);
  assert.equal(db.visuals[a.context.visual_id].status, "generating");
  assert.equal(db.visuals[a.context.visual_id].source_hash, a.context.source_hash);
});

test("enqueue: no API key, provider or endpoint ever rides in the job", async () => {
  const db = fakeDb({ d1: DRAFT }); const q = fakeEnqueue();
  await requestDraftVisual(db, {} as any, q.fn, { authUserId: USER, draftId: "d1" });
  const blob = JSON.stringify(q.calls[0]);
  assert.ok(!/api_key|ai_provider|ai_endpoint|sk-ant/i.test(blob));
});

test("enqueue: double click reattaches to the same placeholder and job", async () => {
  const db = fakeDb({ d1: DRAFT }); const q = fakeEnqueue();
  const a = await requestDraftVisual(db, {} as any, q.fn, { authUserId: USER, draftId: "d1" });
  const b = await requestDraftVisual(db, {} as any, q.fn, { authUserId: USER, draftId: "d1" });
  assert.equal(a.body.visualId, b.body.visualId);
  assert.equal(a.body.jobId, b.body.jobId);
  assert.equal(Object.keys(db.visuals).length, 1);
});

test("enqueue: another user's draft is refused before any write", async () => {
  const db = fakeDb({ d1: DRAFT }); const q = fakeEnqueue();
  const r = await requestDraftVisual(db, {} as any, q.fn, { authUserId: OTHER, draftId: "d1" });
  assert.equal(r.status, 403);
  assert.equal(q.calls.length, 0);
  assert.equal(Object.keys(db.visuals).length, 0);
});

test("enqueue: missing draft is 404 with no write", async () => {
  const db = fakeDb({}); const q = fakeEnqueue();
  const r = await requestDraftVisual(db, {} as any, q.fn, { authUserId: USER, draftId: "nope" });
  assert.equal(r.status, 404); assert.equal(q.calls.length, 0);
});

test("round trip: worker output + PNG completes the placeholder as ready", async () => {
  const db = fakeDb({ d1: DRAFT }); const q = fakeEnqueue();
  await requestDraftVisual(db, {} as any, q.fn, { authUserId: USER, draftId: "d1" });
  const a = q.calls[0];
  const job = { id: "job-1", user_id: USER, status: "completing", path: "interactive",
    input_snapshot: { kind: "interactive", interactiveKind: "draft-visual", context: a.context } };
  db.jobs["job-1"] = job;
  const r = await completeVisualJob(db, { jobId: "job-1", job,
    output: { visual_type: "hero_number", html: "<!DOCTYPE html><html><head></head><body>3 in 5</body></html>" },
    pngBase64: png(a.context.canvas.w, a.context.canvas.h), now: new Date() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = db.visuals[a.context.visual_id];
  assert.equal(v.status, "ready");
  assert.equal(v.image_url, `https://store.example/${USER}/${a.context.visual_id}.png`);
  assert.equal(db.jobs["job-1"].status, "completed");
});

test("round trip: a draft edited mid-flight is refused as stale", async () => {
  const db = fakeDb({ d1: { ...DRAFT } }); const q = fakeEnqueue();
  await requestDraftVisual(db, {} as any, q.fn, { authUserId: USER, draftId: "d1" });
  const a = q.calls[0];
  (await db.getDraft("d1")).body = "Edited after the job was queued.";
  const job = { id: "job-1", user_id: USER, status: "completing", path: "interactive",
    input_snapshot: { kind: "interactive", interactiveKind: "draft-visual", context: a.context } };
  db.jobs["job-1"] = job;
  const r = await completeVisualJob(db, { jobId: "job-1", job,
    output: { visual_type: "x", html: "<html><head></head><body>x</body></html>" },
    pngBase64: png(a.context.canvas.w, a.context.canvas.h), now: new Date() });
  assert.equal(r.status, 422);
  assert.equal(db.visuals[a.context.visual_id].status, "error");
});

test("round trip: wrong PNG size is refused", async () => {
  const db = fakeDb({ d1: DRAFT }); const q = fakeEnqueue();
  await requestDraftVisual(db, {} as any, q.fn, { authUserId: USER, draftId: "d1" });
  const a = q.calls[0];
  const job = { id: "job-1", user_id: USER, status: "completing", path: "interactive",
    input_snapshot: { kind: "interactive", interactiveKind: "draft-visual", context: a.context } };
  db.jobs["job-1"] = job;
  const r = await completeVisualJob(db, { jobId: "job-1", job,
    output: { visual_type: "x", html: "<html><head></head><body>x</body></html>" },
    pngBase64: png(100, 100), now: new Date() });
  assert.equal(r.status, 422);
  assert.equal(db.visuals[a.context.visual_id].status, "error");
});

test("preview: plain interactive job, nothing persisted, sample draft by default", async () => {
  const q = fakeEnqueue();
  const cfg = { display_font: "Lato", body_font: "Lato", color_background: "#101010", color_accent: "#ff0000", color_highlight: "#00ff00", color_sparing_accent: "#0000ff", logo_url: "", logo_min_height: 40, canvas_width: 1200, canvas_height: 627, design_rules: [], enabled_visual_types: [] };
  const r = await requestVisualPreview({} as any, q.fn, { authUserId: USER, config: cfg as any, platform: "instagram" });
  assert.equal(r.status, 202);
  assert.equal(q.calls[0].kind, "visual-preview");
  assert.equal(q.calls[0].context.preview, true);
  assert.equal(q.calls[0].context.visual_id, undefined);
  assert.match(q.calls[0].prompt, /churn quietly/);
});

test("preview: config is required", async () => {
  const q = fakeEnqueue();
  const r = await requestVisualPreview({} as any, q.fn, { authUserId: USER, config: null });
  assert.equal(r.status, 400); assert.equal(q.calls.length, 0);
});
