// Run: node --experimental-strip-types --test supabase/functions/_shared/visual-prompt.test.mts
// The visual prompt must match the worker's offline render contract: the model is
// told NOT to import/link fonts or stylesheets (the renderer rejects every external
// url()/@import). Fonts are named in font-family with a system fallback stack.
import test from "node:test"; import assert from "node:assert/strict";
(globalThis as any).Deno = { env: { get: (_k: string) => undefined } };
const { buildVisualPrompt, legacyBaseSystemPrompt } = await import("./visual-prompt.ts");

const prompts: Record<string, string> = {
  linkedin: buildVisualPrompt({ visual_studio_config: null, visual_design_rules: null }, "linkedin").systemPrompt,
  instagram: buildVisualPrompt({ visual_studio_config: null, visual_design_rules: null }, "instagram").systemPrompt,
  legacy: legacyBaseSystemPrompt(1200, 627, "LinkedIn landscape"),
};
for (const [name, p] of Object.entries(prompts)) {
  test(`${name}: no instruction to import or load external fonts`, () => {
    assert.ok(!/include google fonts import/i.test(p), "old import instruction present");
    assert.ok(!/via google fonts/i.test(p), "old via-Google-Fonts brand line present");
    assert.match(p, /no @import, no <link>, no url\(\)/);
    assert.match(p, /font-family: 'Bricolage Grotesque', system-ui/);
    assert.match(p, /font-family: 'Hanken Grotesk'|'Hanken Grotesk', system-ui/);
  });
}
test("configured custom fonts use the same offline contract", () => {
  const cfg = JSON.stringify({ display_font: "Playfair Display", body_font: "Lato", color_background: "#101010", color_accent: "#ff0000", color_highlight: "#00ff00", color_sparing_accent: "#0000ff", logo_url: "https://example.com/l.png", logo_min_height: 40, canvas_width: 1200, canvas_height: 627, design_rules: [], enabled_visual_types: [] });
  const p = buildVisualPrompt({ visual_studio_config: cfg, visual_design_rules: null }, "linkedin").systemPrompt;
  assert.ok(!/google fonts/i.test(p));
  assert.match(p, /font-family: 'Playfair Display', system-ui/);
  assert.match(p, /'Lato', system-ui/);
});
