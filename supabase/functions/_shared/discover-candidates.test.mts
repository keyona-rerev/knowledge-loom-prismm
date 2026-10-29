// Run: node --experimental-strip-types --test supabase/functions/_shared/discover-candidates.test.mts
// Pure-logic tests (no network, no DB). Client twin is checked against the same cases.
import test from "node:test"; import assert from "node:assert/strict";
import * as S from "./discover-candidates.ts";
import * as C from "../../../src/lib/discoverCandidates.ts";

for (const [name, M] of [["server", S], ["client", C]] as const) {
  test(`${name}: safeUrl accepts public http(s) only`, () => {
    assert.equal(M.safeUrl("https://example.com/a#x"), "https://example.com/a");
    assert.equal(M.safeUrl("http://news.example.org:80/p"), "http://news.example.org/p");
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x", "data:text/html,hi", "//example.com", "example.com/x", "",
      "http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/x", "http://169.254.169.254/latest", "http://[::1]/x", "http://intranet/x",
      "http://a.internal/x", "http://printer.local/x", "https://user:pw@example.com/x", "https://example.com:8443/x", "https://example.com/" + "a".repeat(2100),
      "http://localhost./x", "http://LOCALHOST../x", "http://127.0.0.1./x", "http://a.localhost./x", "http://printer.local./x", "http://host.internal./x", "http://2130706433/x", "http://0x7f.1/x", "http://127.1/x", "http://0177.0.0.1/x", "http://[::ffff:127.0.0.1]/x", "http://[fd00::1]/x", "http://nas.lan/x", "http://x.home.arpa/x", "http://app.corp/x", "http://a.b.1/x"])
      assert.equal(M.safeUrl(bad), null, bad);
  });
  test(`${name}: sanitizeCandidates drops bad/dupe/excluded, strips control chars, caps`, () => {
    const raw = [
      { title: "A\u0000b", url: "https://a.com/1", reason: "r" },
      { title: "dupe", url: "https://a.com/1#frag", reason: "" },
      { title: "excluded", url: "https://seen.com/x", reason: "" },
      { title: "bad", url: "javascript:1", reason: "" },
      null, 5, { url: 7 },
      ...Array.from({ length: 40 }, (_, i) => ({ title: "t" + i, url: `https://site${i}.com/p`, reason: "x".repeat(500) })),
    ];
    const out = M.sanitizeCandidates(raw, ["https://seen.com/x"]);
    assert.equal(out.length, 25);
    assert.equal(out[0].title, "A b");
    assert.ok(!out.some((c) => c.url.includes("seen.com") || c.url.startsWith("javascript")));
    assert.equal(new Set(out.map((c) => c.url)).size, out.length);
    assert.ok(out.every((c) => c.reason.length <= 200 && c.title.length <= 300));
    assert.deepEqual(M.sanitizeCandidates("not an array"), []);
  });
  test(`${name}: parseCandidates tolerates fences/preamble, throws on junk`, () => {
    const t = 'Here:\n```json\n{"candidates":[{"title":"T","url":"https://x.com/a","reason":"r"}]}\n```';
    assert.equal(M.parseCandidates(t).length, 1);
    assert.throws(() => M.parseCandidates("no json here"));
    assert.deepEqual(M.parseCandidates('{"candidates":"x"}'), []);
  });
}

test("buildDiscoveryPrompt: only saved public topics; throws when none; nothing else leaves", () => {
  const p = S.buildDiscoveryPrompt({ topics: ["community bank liquidity", "Rates", "rates", "a".repeat(300), "x\u0000y"] }, 99);
  assert.match(p, /Topics: community bank liquidity; Rates; a{80}; x y\n/);
  assert.ok(!/a{81}/.test(p));
  assert.match(p, /find 15 distinct/);
  assert.ok(!/Company:|Positioning:|Framing rules:|Audience thesis|Institution|Fit criteria|already seen|Do NOT return/i.test(p));
  assert.throws(() => S.buildDiscoveryPrompt({}, 5), /No discovery topics/);
  assert.throws(() => S.buildDiscoveryPrompt({ topics: ["  ", ""] }, 5), /No discovery topics/);
  assert.equal(S.cleanTopics(Array.from({ length: 20 }, (_, i) => "t" + i)).length, 8);
  assert.deepEqual(S.cleanTopics("not an array"), []);
});
test("verifyCandidates fails closed without verified URLs and keeps only verified ones", () => {
  const c = [{ title: "a", url: "https://a.com/x", reason: "" }, { title: "b", url: "https://b.com/y", reason: "" }];
  for (const bad of [undefined, null, [], ["javascript:1"], "https://a.com/x", {}]) assert.throws(() => S.verifyCandidates(c, bad), /provenance/i);
  assert.deepEqual(S.verifyCandidates(c, ["https://a.com/x#frag", "http://127.0.0.1/z"]).map((x) => x.url), ["https://a.com/x"]);
  assert.deepEqual(C.verifyCandidates(c, ["https://b.com/y"]).map((x) => x.url), ["https://b.com/y"]);
  assert.throws(() => C.verifyCandidates(c, []), /provenance/i);
});
test("DISCOVER_KIND is the exact literal the worker workflow matches", () => assert.equal(S.DISCOVER_KIND, "discover-sources"));
