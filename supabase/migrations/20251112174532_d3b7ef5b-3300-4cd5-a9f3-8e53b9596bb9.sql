-- Add content_type_templates to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS content_type_templates jsonb DEFAULT '[
  {
    "id": "linkedin",
    "name": "LinkedIn Post",
    "prompt": "LinkedIn posts are concise, professional updates (1300-1500 characters max). Structure: Hook opening line, 2-3 key points with line breaks for readability, call-to-action or question to drive engagement. Tone: Professional yet conversational, thought leadership style. Include: Industry insights, actionable takeaways, personal perspective. Formatting: Short paragraphs (1-2 sentences), strategic emoji use, clear spacing."
  },
  {
    "id": "blog_post",
    "name": "Blog Post",
    "prompt": "Blog posts are comprehensive, SEO-optimized articles (1200-2000 words). Structure: Compelling headline, engaging introduction with hook, 3-5 main sections with H2/H3 headers, concrete examples and data, summary with clear takeaways. Tone: Authoritative yet accessible, educational. Include: Research-backed insights, real-world examples, actionable advice, internal/external links. Formatting: Scannable with subheadings, bullet points, short paragraphs (3-4 sentences)."
  },
  {
    "id": "case_study",
    "name": "Case Study",
    "prompt": "Case studies are detailed success stories (1500-2500 words). Structure: Executive summary, challenge/problem statement, solution approach with methodology, results with specific metrics/outcomes, key learnings. Tone: Professional, analytical, results-focused. Include: Specific data and metrics, before/after comparisons, quotes or testimonials, visual data representations. Formatting: Clear sections with headers, data callout boxes, conclusion with replicable insights."
  }
]'::jsonb;

COMMENT ON COLUMN public.profiles.content_type_templates IS 'User-defined content type templates with custom prompts for AI generation';