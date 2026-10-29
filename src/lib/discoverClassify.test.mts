// Run: node --experimental-strip-types --test src/lib/discoverClassify.test.mts
import test from "node:test"; import assert from "node:assert/strict";
import { classifyCard, canKeepAnyway } from "./discoverClassify.ts";
test("unscored/queued are awaiting, never failed or rejected", () => {
  assert.equal(classifyCard({ relevance_state: "unscored", status: "processing", global_relevance_score: null }), "awaiting");
  assert.equal(classifyCard({ relevance_state: "queued", status: "processing", global_relevance_score: null }), "awaiting");
});
test("failed queue state is failed", () => assert.equal(classifyCard({ relevance_state: "failed", status: "active", global_relevance_score: null }), "failed"));
test("scored+archived is archived; scored active is active", () => {
  assert.equal(classifyCard({ relevance_state: "scored", status: "archived", global_relevance_score: 2 }), "archived");
  assert.equal(classifyCard({ relevance_state: "scored", status: "active", global_relevance_score: 8 }), "active");
});
test("legacy: null state + null score = failed; null state + score = active; missing = gone", () => {
  assert.equal(classifyCard({ relevance_state: null, status: "active", global_relevance_score: null }), "failed");
  assert.equal(classifyCard({ relevance_state: null, status: "active", global_relevance_score: 7 }), "active");
  assert.equal(classifyCard(null), "gone");
});
test("force_keep restore allowed ONLY for archived", () => {
  for (const c of ["awaiting", "failed", "active", "gone"] as const) assert.equal(canKeepAnyway(c), false);
  assert.equal(canKeepAnyway("archived"), true);
});

test("needs_review is not kept", () => assert.equal(classifyCard({ relevance_state: null, status: "needs_review", global_relevance_score: null }), "review"));
