-- Add template_id column to drafts table
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES content_templates(id);

-- Update default templates to match exact specifications
DELETE FROM content_templates WHERE is_system_template = true;

-- LinkedIn Post Template
INSERT INTO content_templates (name, description, content_type, template_structure, is_active, is_system_template) VALUES
(
  'LinkedIn Post',
  'Professional LinkedIn post with hook, insights, and call-to-action',
  'social_post',
  '{
    "goal": "Create engaging LinkedIn content that drives professional engagement",
    "structure": {
      "hook": {
        "description": "Attention-grabbing opening question or statement",
        "max_chars": 120
      },
      "body": {
        "description": "2-3 key insights with data or examples",
        "min_words": 150,
        "max_words": 300,
        "formatting": "bold_key_concepts"
      },
      "cta": {
        "description": "Clear call-to-action for engagement",
        "required_elements": ["question", "engagement_prompt"]
      },
      "hashtags": {
        "count": 5
      }
    },
    "voice_guidelines": "Professional, insightful, conversational"
  }'::jsonb,
  true,
  true
);

-- Case Study Template
INSERT INTO content_templates (name, description, content_type, template_structure, is_active, is_system_template) VALUES
(
  'Case Study',
  'Structured case study with problem, solution, and results',
  'blog_post',
  '{
    "goal": "Showcase successful outcomes through structured storytelling",
    "structure": {
      "title": {
        "max_chars": 80
      },
      "hook": {
        "description": "Client challenge or problem statement",
        "max_chars": 200
      },
      "body": {
        "description": "Solution implementation and measurable results",
        "min_words": 800,
        "max_words": 1500,
        "sections": ["challenge", "solution", "implementation", "results", "key_takeaways"]
      },
      "cta": {
        "description": "Invitation to learn more or discuss similar challenges"
      }
    },
    "voice_guidelines": "Professional, evidence-based, client-focused"
  }'::jsonb,
  true,
  true
);

-- Blog Post Template
INSERT INTO content_templates (name, description, content_type, template_structure, is_active, is_system_template) VALUES
(
  'Blog Post',
  'Comprehensive blog post with introduction, body, and conclusion',
  'blog_post',
  '{
    "goal": "Provide valuable insights through well-structured long-form content",
    "structure": {
      "title": {
        "max_chars": 100
      },
      "hook": {
        "description": "Engaging introduction that sets up the topic",
        "max_chars": 150
      },
      "body": {
        "description": "In-depth exploration with subheadings and examples",
        "min_words": 1000,
        "max_words": 2000,
        "formatting": "bold_key_concepts"
      },
      "cta": {
        "description": "Thought-provoking conclusion or next steps"
      }
    },
    "voice_guidelines": "Authoritative, educational, engaging"
  }'::jsonb,
  true,
  true
);