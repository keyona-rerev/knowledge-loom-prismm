-- Create content_templates table
CREATE TABLE content_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  name VARCHAR NOT NULL,
  content_type VARCHAR NOT NULL,
  description TEXT,
  template_structure JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  is_system_template BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE content_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own templates and system templates"
  ON content_templates FOR SELECT
  USING (auth.uid() = user_id OR is_system_template = true);

CREATE POLICY "Users can insert own templates"
  ON content_templates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own templates"
  ON content_templates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own templates"
  ON content_templates FOR DELETE
  USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_content_templates_updated_at
  BEFORE UPDATE ON content_templates
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- Insert default templates
INSERT INTO content_templates (name, content_type, description, template_structure, is_system_template) 
VALUES (
  'LinkedIn Strategic Post',
  'linkedin',
  'Professional engagement-focused posts with strategic insights',
  '{
    "goal": "Generate a concise LinkedIn post designed to maximize professional engagement",
    "required_inputs": ["core_strategic_topic", "quantifiable_takeaway", "target_executive", "data_point", "cta"],
    "structure": {
      "hook": {"max_chars": 80, "description": "Curiosity-driven opening line"},
      "body": {"min_words": 120, "max_words": 180, "formatting": "bold_key_concepts"},
      "cta": {"required": true, "description": "Clear call-to-action"},
      "hashtags": {"count": 4, "description": "Professional, specific hashtags"}
    },
    "voice_guidelines": "Authoritative, Data-Driven, Strategic Focus",
    "quality_checks": ["preserve_strategic_angle", "use_quantifiable_data", "maintain_professional_tone"]
  }'::jsonb,
  true
);

INSERT INTO content_templates (name, content_type, description, template_structure, is_system_template)
VALUES (
  'Detailed Case Study', 
  'case_study',
  'Results-driven narrative showcasing problem-solving ability',
  '{
    "goal": "Generate a structured case study demonstrating quantifiable success",
    "required_inputs": ["client_industry", "challenge_pain_point", "solution_strategy", "quantifiable_results", "desired_tone"],
    "structure": {
      "title": {"description": "Results-focused compelling title"},
      "executive_summary": {"sentences": 3, "description": "Challenge, Solution, Main Result"},
      "the_challenge": {"approx_words": 150, "description": "Detailed problem setup"},
      "the_solution": {"approx_words": 200, "description": "Strategy and methodology"}, 
      "the_results": {"approx_words": 100, "description": "Quantifiable outcomes"},
      "conclusion": {"approx_words": 50, "description": "Key takeaway + soft CTA"}
    },
    "voice_guidelines": "Authoritative and empathetic, Confident and innovative",
    "quality_checks": ["focus_on_data", "clear_narrative_flow", "demonstrate_expertise"]
  }'::jsonb,
  true
);

INSERT INTO content_templates (name, content_type, description, template_structure, is_system_template)
VALUES (
  'Educational Blog Post',
  'blog_post', 
  'Comprehensive educational content optimized for search',
  '{
    "goal": "Generate a comprehensive blog post providing deep value to target audience",
    "required_inputs": ["main_topic_thesis", "target_audience", "primary_keywords", "supporting_points", "desired_tone"],
    "structure": {
      "title": {"description": "Compelling, keyword-rich title"},
      "introduction": {"approx_words": 100, "description": "Problem statement + thesis"},
      "body_sections": {"description": "Use H2 headings, detailed with examples"},
      "conclusion": {"approx_words": 75, "description": "Summary + actionable step"}
    },
    "voice_guidelines": "Highly educational and slightly academic, Friendly and accessible",
    "quality_checks": ["comprehensive_coverage", "natural_keyword_integration", "actionable_insights"]
  }'::jsonb,
  true
);