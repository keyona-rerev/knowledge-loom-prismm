# Content Generation Flow - Settings Integration

## Overview
All content generation now pulls from user Settings to ensure consistent voice, style, and format across all AI-generated content.

## Settings Configuration (src/pages/Settings.tsx)

Users can configure:

### 1. Writing Style & Voice (writing_examples)
- Up to 4 examples of their writing (200-500 words each)
- AI learns tone, structure, vocabulary, sentence flow
- Examples teach STYLE only, not content/topics

### 2. Content Type Templates (content_type_templates)
Each template defines:
- **Name**: Display name (editable)
- **ID**: Internal identifier (read-only: `linkedin`, `blog_post`, `case_study`, etc.)
- **Prompt**: Detailed guidelines for structure, tone, length, requirements

Default templates:
- **LinkedIn Post**: 1300-1500 chars, professional, hook + points + CTA
- **Blog Post**: 1200-2000 words, SEO-optimized, headers + examples + takeaways
- **Case Study**: 1500-2500 words, analytical, problem + solution + metrics

Users can add custom types (e.g., "Email Newsletter", "Twitter Thread")

### 3. Colors
- Primary, Secondary, Accent colors
- Applied dynamically via ColorProvider across entire app

---

## Edge Functions Integration

All content generation functions now load from profiles table:

### generate-final-content/index.ts
**Loads from profiles:**
- `writing_examples` - for voice training
- `content_type_templates` - for format requirements
- `business_name`, `target_audience` - for context

**Usage**: When user selects a direction in CreateContent
**Prompt includes**: Content type requirements + Writing voice examples

### generate-content-from-card/index.ts
**Loads from profiles:**
- `content_type_templates` - for format requirements
- `writing_examples` - for voice training

**Usage**: When generating content directly from a reference card
**Prompt includes**: Content type requirements + Writing voice examples

### regenerate-draft-with-feedback/index.ts
**Loads from profiles:**
- `content_type_templates` - maintains format consistency
- `writing_examples` - preserves voice in revisions

**Usage**: When user provides feedback to improve a draft (Review page, DraftDetail)
**Prompt includes**: Original draft + Feedback + Content type requirements + Voice examples

---

## Frontend Pages Integration

### CreateContent.tsx
- Loads `content_type_templates` from profile on mount
- Displays templates in dropdown
- Passes selected template ID to `generate-final-content`

### DraftDetail.tsx
- Calls `regenerate-draft-with-feedback` with draft's content_type
- Template requirements automatically applied

### Review.tsx
- Calls `regenerate-draft-with-feedback` with feedback
- Template requirements automatically applied

---

## Data Flow

```
User Updates Settings
    ↓
profiles.content_type_templates updated
profiles.writing_examples updated
    ↓
Edge Functions query profiles table
    ↓
AI receives:
  - Content type requirements
  - Writing style examples
  - Business context
    ↓
Generated content matches:
  - User's writing voice
  - Correct content format
  - Business context
```

---

## Key Benefits

1. **Centralized Control**: All AI settings in one place
2. **Consistency**: Same voice/format across all generated content
3. **Flexibility**: Add custom content types as needed
4. **Quality**: Better output with proper templates + voice training
5. **No Code Required**: Users configure via UI, no hardcoded prompts

---

## Template ID System

- **Built-in IDs** (read-only): `linkedin`, `blog_post`, `case_study`
- **Custom IDs**: Auto-generated as `custom_{timestamp}` when user adds new template
- **Usage**: IDs are used internally by edge functions to match templates
- **User-facing**: Users only edit template name and prompt, not ID
