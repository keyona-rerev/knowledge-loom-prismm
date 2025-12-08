# Insight Forge - Technical Handoff Documentation

**For IT Teams and Developers**

This document covers the technical setup, configuration, and maintenance of Insight Forge.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Technology Stack](#technology-stack)
3. [Database Schema](#database-schema)
4. [Edge Functions](#edge-functions)
5. [Mailgun Configuration](#mailgun-configuration)
6. [AI Provider Setup](#ai-provider-setup)
7. [Deployment Guide](#deployment-guide)
8. [Environment Variables](#environment-variables)
9. [Security Considerations](#security-considerations)
10. [Maintenance Tasks](#maintenance-tasks)
11. [Troubleshooting](#troubleshooting)
12. [Database Migration Reference](#database-migration-reference)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        INSIGHT FORGE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │   Frontend   │────▶│   Supabase   │────▶│  AI Provider │   │
│  │  React/Vite  │     │   Backend    │     │              │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
│         │                    │                    │            │
│         │                    │                    │            │
│         ▼                    ▼                    ▼            │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │   Hosting    │     │  PostgreSQL  │     │  Google AI   │   │
│  │   (Render)   │     │   Database   │     │  or Custom   │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
│                              │                                 │
│                              │                                 │
│                       ┌──────────────┐                        │
│                       │   Mailgun    │                        │
│                       │   Webhook    │                        │
│                       └──────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Content Ingestion:**
   - Newsletters → Mailgun → Edge Function → Database
   - Manual URLs/PDFs → Edge Function → Database
   - Observations → Direct Database Insert

2. **AI Processing:**
   - Reference Card Created → `process-reference-card` → AI API → Database Update

3. **Content Generation:**
   - User Request → `generate-content-from-card` → AI API → Draft Created

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3.x | UI Framework |
| Vite | Latest | Build Tool |
| TypeScript | 5.x | Type Safety |
| Tailwind CSS | 3.x | Styling |
| React Router | 6.x | Routing |
| TanStack Query | 5.x | Data Fetching |
| Shadcn/UI | Latest | Component Library |

### Backend
| Technology | Purpose |
|------------|---------|
| Supabase | Database, Auth, Edge Functions |
| PostgreSQL | Data Storage |
| Deno | Edge Function Runtime |

### External Services
| Service | Purpose |
|---------|---------|
| Mailgun | Email Receiving (Newsletter Inbox) |
| Google AI / Custom | Content Generation |

---

## Database Schema

### Core Tables

#### `profiles`
User profiles with business context and AI settings.

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  business_name TEXT,
  business_description TEXT,
  target_audience TEXT,
  brand_voice TEXT,
  email TEXT,
  -- AI Configuration
  ai_provider TEXT DEFAULT 'lovable-ai',
  ai_model TEXT DEFAULT 'gemini-2.0-flash-exp',
  google_ai_api_key TEXT,
  custom_ai_endpoint TEXT,
  custom_ai_model_name TEXT,
  -- Newsletter
  newsletter_domain TEXT,
  -- Appearance
  primary_color TEXT DEFAULT '#9b87f5',
  secondary_color TEXT DEFAULT '#7E69AB',
  accent_color TEXT DEFAULT '#6E59A5',
  -- Content Templates (JSON)
  content_type_templates JSONB,
  writing_examples JSONB DEFAULT '[]',
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### `reference_cards`
Source content with AI analysis.

```sql
CREATE TABLE reference_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  source_feed_id UUID REFERENCES source_feeds(id),
  template_id UUID REFERENCES reference_card_templates(id),
  question_set_id UUID,
  -- Content
  title TEXT,
  original_text TEXT,
  ai_summary TEXT,
  source_url TEXT,
  source_type TEXT, -- 'newsletter', 'manual', 'pdf', 'observation'
  -- AI Analysis
  insight_answers JSONB DEFAULT '{}',
  global_relevance_score INTEGER DEFAULT 5,
  content_quality TEXT DEFAULT 'unknown',
  content_warning TEXT,
  -- Status
  status TEXT DEFAULT 'active', -- 'active', 'needs_review', 'archived'
  is_used BOOLEAN DEFAULT false,
  modified_by_user BOOLEAN DEFAULT false,
  version_history JSONB DEFAULT '[]',
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### `drafts`
Generated content awaiting review/publishing.

```sql
CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  autopilot_template_id UUID REFERENCES autopilot_templates(id),
  template_id UUID REFERENCES content_templates(id),
  revised_from UUID REFERENCES drafts(id),
  -- Content
  title TEXT,
  body TEXT,
  content_type TEXT,
  -- Generation Context
  seed_insight TEXT,
  seed_category TEXT,
  selected_direction TEXT,
  reference_card_ids UUID[],
  article_relevance_scores JSONB DEFAULT '{}',
  insights_summary TEXT[],
  -- Review
  status TEXT DEFAULT 'draft',
  approval_status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  review_notes TEXT,
  revision_feedback TEXT,
  manual_revision_notes TEXT,
  revision_count INTEGER DEFAULT 0,
  -- Scheduling
  scheduled_publish_date TIMESTAMPTZ,
  -- Timestamps
  submitted_for_approval_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### `user_newsletter_emails`
Unique newsletter email addresses per user.

```sql
CREATE TABLE user_newsletter_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email_prefix TEXT NOT NULL,
  email_address TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `newsletter_emails`
Log of received newsletter emails.

```sql
CREATE TABLE newsletter_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  from_address TEXT,
  subject TEXT,
  reference_card_id UUID REFERENCES reference_cards(id),
  processing_status TEXT DEFAULT 'pending',
  received_at TIMESTAMPTZ DEFAULT now()
);
```

### Supporting Tables

| Table | Purpose |
|-------|---------|
| `source_feeds` | RSS/Newsletter source definitions |
| `autopilot_templates` | Automated content generation schedules |
| `content_templates` | Content type definitions (LinkedIn, Blog, etc.) |
| `content_calendar` | Scheduled content dates |
| `question_sets` | Custom question sets for AI analysis |
| `insight_cards` | User observations/insights |
| `reference_card_templates` | Deprecated, use question_sets |
| `draft_revisions` | Version history for drafts |
| `insight_ratings` | Rating system for insights |
| `email_notifications` | Notification log |

### Row-Level Security (RLS)

All tables have RLS enabled. Users can only access their own data:

```sql
-- Example policy pattern
CREATE POLICY "Users can view own records"
ON table_name FOR SELECT
USING (auth.uid() = user_id);
```

---

## Edge Functions

### Function Overview

| Function | Purpose | Auth Status |
|----------|---------|-------------|
| `process-newsletter-email` | Mailgun webhook handler | Public (webhook signature verified) |
| `create-manual-source` | URL/PDF processing | ✅ Secure (JWT from header) |
| `process-reference-card` | AI analysis of cards | ⚠️ JWT disabled |
| `generate-content-directions` | AI content angle suggestions | ⚠️ JWT disabled |
| `generate-content-from-card` | Draft generation | ⚠️ JWT disabled |
| `generate-final-content` | Final content polish | ⚠️ JWT disabled |
| `regenerate-draft-with-feedback` | Revision with feedback | ⚠️ JWT disabled |
| `execute-autopilot-template` | Scheduled automation | ⚠️ JWT disabled |
| `send-draft-notification` | Email notifications | ⚠️ JWT disabled |
| `pull-rss-feed` | RSS/Google Alerts fetching | ⚠️ JWT disabled |

> **⚠️ Security Note:** Most edge functions currently have JWT verification disabled (`verify_jwt = false` in config.toml). While RLS policies protect database access, this means functions can be called without authentication. For production hardening, consider enabling JWT verification and extracting userId from the authenticated session instead of request body.

### Key Function Details

#### `process-newsletter-email`

**Endpoint:** `https://[PROJECT_ID].supabase.co/functions/v1/process-newsletter-email`

**Purpose:** Receives emails from Mailgun webhook, creates reference cards.

**Flow:**
1. Receive POST from Mailgun (form-data or JSON)
2. **Verify Mailgun signature** (HMAC-SHA256 when `MAILGUN_SIGNING_KEY` configured)
3. Extract recipient email to find user
4. Check rate limit (50 emails/hour/user)
5. Create reference_card with source_type='newsletter'
6. Log to newsletter_emails table
7. Trigger process-reference-card for AI analysis

**JWT Verification:** Disabled (public webhook with signature verification)

#### `create-manual-source`

**Purpose:** Process manually added URLs and PDFs.

**Authentication:** ✅ Secure - extracts userId from Authorization header JWT, not request body.

**Parameters:**
```json
{
  "type": "url" | "pdf",
  "url": "https://...",
  "pdf_text": "extracted text...",
  "pdf_title": "Document Title",
  "question_set_id": "uuid" // optional
}
```

#### `process-reference-card`

**Purpose:** Run AI analysis on a reference card.

**Flow:**
1. Fetch card and user profile
2. Get question set (global or specific)
3. Call AI provider with content + questions
4. Parse AI response
5. Update card with insight_answers

**Rate Limit:** 100 calls/hour/user

#### `generate-content-from-card`

**Purpose:** Generate draft content from reference cards.

**Rate Limit:** 50 calls/hour/user

**Parameters:**
```json
{
  "cardId": "uuid",
  "templateId": "uuid", // content template
  "outputFormat": "linkedin" | "blog_post" | "case_study",
  "userId": "uuid"
}
```

---

## Mailgun Configuration

### Prerequisites

- Mailgun account (mailgun.com)
- Domain you control for receiving email
- DNS access to add MX and TXT records

### Step-by-Step Setup

#### 1. Create Mailgun Account

1. Go to [mailgun.com](https://mailgun.com)
2. Sign up for account (free tier available)
3. Verify your email

#### 2. Add Receiving Domain

1. In Mailgun dashboard → **Sending** → **Domains**
2. Click **Add New Domain**
3. Enter subdomain: `newsletters.yourdomain.com`
4. Select region (US or EU)

#### 3. Configure DNS Records

Add these DNS records to your domain:

**MX Records (for receiving email):**
```
Type: MX
Host: newsletters
Value: mxa.mailgun.org
Priority: 10

Type: MX
Host: newsletters
Value: mxb.mailgun.org
Priority: 10
```

**TXT Records (for verification):**
```
Type: TXT
Host: newsletters
Value: [Mailgun provides this - copy from dashboard]
```

**SPF Record (optional, for sending):**
```
Type: TXT
Host: newsletters
Value: v=spf1 include:mailgun.org ~all
```

#### 4. Verify Domain

1. Wait for DNS propagation (up to 48 hours)
2. In Mailgun → **Domains** → Click your domain
3. Click **Verify DNS Settings**
4. All records should show green checkmarks

#### 5. Enable Receiving

1. Go to **Receiving** in Mailgun dashboard
2. Ensure receiving is enabled for your domain

#### 6. Create Route (Webhook)

1. Go to **Receiving** → **Routes**
2. Click **Create Route**
3. Configure:

| Field | Value |
|-------|-------|
| Expression Type | Catch All |
| Priority | 0 |
| Actions | Forward: `https://[YOUR-PROJECT-ID].supabase.co/functions/v1/process-newsletter-email` |
| Description | Insight Forge Newsletter Webhook |

4. Save route

**Note:** Replace `[YOUR-PROJECT-ID]` with your production Supabase project ID.

#### 7. Get Webhook Signing Key

1. Go to Mailgun Dashboard → **Webhooks** (or API Security)
2. Find **Webhook Signing Key**
3. Copy this key - you'll need it for the `MAILGUN_SIGNING_KEY` secret

#### 8. Configure App

1. User logs into Insight Forge
2. Go to **Settings**
3. Under **Newsletter Email Configuration**
4. Enter: `newsletters.yourdomain.com`
5. Save

### Testing

1. Send test email to: `test@newsletters.yourdomain.com`
2. Check Mailgun logs for delivery
3. Check Supabase edge function logs
4. Verify reference_card created in database

### Troubleshooting Mailgun

| Issue | Solution |
|-------|----------|
| DNS not verifying | Wait 24-48 hours, check records |
| Emails not arriving | Check MX records, verify receiving enabled |
| Webhook not firing | Check route configuration, test with curl |
| 4xx errors in logs | Check edge function logs in Supabase |

---

## AI Provider Setup

### Option 1: Google AI (Recommended for Production)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with Google account
3. Click **Get API Key**
4. Create new API key
5. Copy the key

**In Insight Forge:**
1. Go to Settings → AI Provider Configuration
2. Select **Google AI**
3. Paste API key
4. Model: `gemini-2.0-flash-exp` (default)
5. Save

### Option 2: Custom Provider

For OpenAI-compatible endpoints:

1. Settings → AI Provider Configuration
2. Select **Custom Provider**
3. Enter:
   - **Endpoint URL:** `https://api.openai.com/v1/chat/completions`
   - **Model Name:** `gpt-4o` or your model
   - **API Key:** Your API key
4. Save

### Option 3: Lovable AI (Development Only)

Default fallback when no provider configured. **Not for production use.**

### Fallback Behavior

Edge functions check AI provider in this order:
1. Google AI (if api key configured)
2. Custom Provider (if endpoint configured)
3. Lovable AI (fallback)

---

## Deployment Guide

### Deploying to Render

#### 1. Create Render Account

1. Go to [render.com](https://render.com)
2. Sign up / Sign in
3. Connect GitHub account

#### 2. Create Static Site

1. Dashboard → **New** → **Static Site**
2. Connect repository
3. Configure:

| Setting | Value |
|---------|-------|
| Name | insight-forge |
| Branch | main |
| Build Command | `npm run build` |
| Publish Directory | `dist` |

#### 3. Environment Variables

Add in Render dashboard:

```
VITE_SUPABASE_URL=https://[PROJECT_ID].supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=[anon key]
```

#### 4. SPA Routing Fix (CRITICAL)

> **⚠️ Important:** The `public/_redirects` file in the repository does NOT work on Render. You must configure rewrite rules in the Render Dashboard.

**Steps to fix SPA routing:**

1. Go to Render Dashboard → Your Static Site → **Settings**
2. Scroll to **Redirects/Rewrites** section
3. Click **Add Rule**
4. Configure:

| Field | Value |
|-------|-------|
| Source | `/*` |
| Destination | `/index.html` |
| Type | **Rewrite** (not Redirect) |

5. Save

This ensures React Router handles all routes correctly. Without this, refreshing any page except the homepage will show "Not Found".

#### 5. Deploy

1. Push to main branch
2. Render auto-deploys
3. Access at your Render URL

**Note:** After adding the rewrite rule, you may need to trigger a manual redeploy for it to take effect.

### Custom Domain on Render

1. Settings → Custom Domains
2. Add domain
3. Configure DNS:
   - CNAME to `[your-site].onrender.com`
4. SSL auto-provisions

---

## Environment Variables

### Frontend (Vite)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ID |

### Edge Functions (Auto-provided by Supabase)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (full access) |
| `LOVABLE_API_KEY` | Lovable AI gateway key (fallback) |

### Edge Functions (User-configured Secrets)

| Variable | Description | Required |
|----------|-------------|----------|
| `MAILGUN_SIGNING_KEY` | Mailgun webhook signing key for signature verification | **Yes** (Production) |

---

## Production Migration Guide

### Overview

When migrating from development to production Supabase:

- **Development:** `https://xtaslgxrgzksojtoekmz.supabase.co`
- **Production:** Your own Supabase project

### Step 1: Database Migrations

Run these SQL migrations in your **production** Supabase SQL Editor:

```sql
-- 1. Add UNIQUE constraint to email_prefix (CRITICAL SECURITY)
ALTER TABLE user_newsletter_emails 
ADD CONSTRAINT email_prefix_unique UNIQUE (email_prefix);
```

Verify the constraint was added:
```sql
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'user_newsletter_emails'::regclass;
```

### Step 2: Deploy Edge Functions

Using Supabase CLI:

```bash
# Login to Supabase
supabase login

# Link to production project
supabase link --project-ref [YOUR-PROJECT-ID]

# Deploy all functions
supabase functions deploy

# Or deploy specific function
supabase functions deploy process-newsletter-email
```

### Step 3: Configure Secrets

In production Supabase Dashboard → Edge Functions → Secrets, add:

| Secret Name | Value | Where to Find |
|-------------|-------|---------------|
| `MAILGUN_SIGNING_KEY` | Your Mailgun signing key | Mailgun Dashboard → Webhooks → Webhook Signing Key |

### Step 4: Update Mailgun Webhook

In Mailgun Dashboard → Receiving → Routes, update the webhook URL to point to your production Supabase project:

```
https://[YOUR-PROJECT-ID].supabase.co/functions/v1/process-newsletter-email
```

### Step 5: Update Frontend Environment

Update your deployment environment variables:

| Variable | Production Value |
|----------|-----------------|
| `VITE_SUPABASE_URL` | `https://[YOUR-PROJECT-ID].supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | [Production anon key] |
| `VITE_SUPABASE_PROJECT_ID` | `[YOUR-PROJECT-ID]` |

### Step 6: Verify Migration

1. **Test newsletter flow:** Send test email to production newsletter address
2. **Check edge function logs:** Verify "✅ Mailgun signature verified successfully" in logs
3. **Verify rate limiting:** Check rate limit logs work correctly
4. **Test authentication:** Ensure login/signup works with production auth

---

## Security Considerations

### Row-Level Security

All tables have RLS enabled. Verify policies:

```sql
-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- View policies
SELECT * FROM pg_policies WHERE schemaname = 'public';
```

### API Keys

- **Never expose** service role key to frontend
- **Store AI keys** in profiles table (encrypted at rest)
- **Use anon key** for frontend Supabase client

### Webhook Security

`process-newsletter-email` implements:
- **Mailgun signature verification** (HMAC-SHA256) when `MAILGUN_SIGNING_KEY` is configured
- **Rate limiting** (50 emails/hour/user)
- **Domain validation** (ensures email matches user's configured domain)

**CRITICAL:** Always configure `MAILGUN_SIGNING_KEY` in production to prevent unauthorized webhook calls.

### XSS Protection

The application uses **DOMPurify** to sanitize HTML content before rendering. All uses of `dangerouslySetInnerHTML` are wrapped with DOMPurify.sanitize() with restricted allowed tags:
- Allowed tags: `p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `h1`-`h6`, `blockquote`, `a`, `code`, `pre`
- Allowed attributes: `href`, `target`, `rel` (on links only)

### SSRF Protection

URL fetching functions (`pull-rss-feed`, `create-manual-source`) implement Server-Side Request Forgery protection:
- **Blocked IP ranges:** 127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 0.0.0.0/8, 169.254.0.0/16
- **Blocked protocols:** file://, localhost, gopher://
- Prevents attackers from using the app to access internal resources

### PDF Validation

PDF uploads are validated with:
- **MIME type check:** Must be `application/pdf`
- **Magic bytes check:** File must start with `%PDF` header
- **Size limits:** Max 50 pages, 50,000 characters

### Password Policy

User passwords must meet these requirements (enforced on signup):
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

### Rate Limiting

Rate limits are enforced on AI-intensive operations:

| Function | Rate Limit |
|----------|------------|
| Newsletter email processing | 50/hour/user |
| Reference card processing | 100/hour/user |
| Content generation | 50/hour/user |
| Draft regeneration | 50/hour/user |
| Final content generation | 50/hour/user |

```sql
-- Check recent emails for rate limiting
SELECT COUNT(*) FROM newsletter_emails 
WHERE user_id = $1 
AND received_at > NOW() - INTERVAL '1 hour';
```

### Email Prefix Security

Email prefixes use `crypto.randomUUID()` for cryptographically secure generation.
Database enforces uniqueness via `email_prefix_unique` constraint.

### Known Security Limitations

> **Note for Production Hardening:** The following items are acceptable for single-tenant handoff but should be addressed for multi-tenant deployments:

1. **Edge Function JWT Bypass:** Most functions have `verify_jwt = false`. They rely on RLS for data protection, but endpoints are publicly callable.

2. **userId from Request Body:** Some functions accept userId from the request body instead of extracting from JWT. The pattern from `create-manual-source` (extracting from Authorization header) should be applied to other functions for full security.

---

## Maintenance Tasks

### Regular Tasks

| Task | Frequency | Action |
|------|-----------|--------|
| Monitor edge function logs | Daily | Check for errors in Supabase dashboard |
| Database backups | Auto (Supabase) | Verify backups are running |
| AI provider credits | Weekly | Check Google AI / OpenAI usage |
| Mailgun deliverability | Weekly | Check Mailgun dashboard for issues |

### Database Cleanup

```sql
-- Archive old reference cards (>90 days, unused)
UPDATE reference_cards 
SET status = 'archived'
WHERE created_at < NOW() - INTERVAL '90 days'
AND is_used = false
AND status = 'active';

-- Delete old newsletter logs (>30 days)
DELETE FROM newsletter_emails
WHERE received_at < NOW() - INTERVAL '30 days';
```

### Monitoring

Check these in Supabase dashboard:
- **Edge Function Logs:** Invocations, errors, duration
- **Database:** Connection count, query performance
- **Auth:** Sign-in activity, failed attempts

---

## Troubleshooting

### Edge Function Errors

**View logs:**
1. Supabase Dashboard → Edge Functions
2. Select function
3. View Logs tab

**Common errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `LOVABLE_API_KEY not set` | Missing secret | Check Supabase secrets |
| `AI provider not configured` | No API key in profile | User must configure in Settings |
| `Rate limit exceeded` | Too many newsletters | Wait or increase limit |
| `Failed to parse request` | Malformed webhook | Check Mailgun payload |

### Database Issues

**Check RLS blocking:**
```sql
-- Temporarily bypass RLS for debugging
SET ROLE postgres;
SELECT * FROM reference_cards WHERE user_id = '[uuid]';
RESET ROLE;
```

**Check constraints:**
```sql
-- View table constraints
SELECT conname, contype, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'reference_cards'::regclass;
```

### Newsletter Not Processing

1. **Check Mailgun logs** for delivery status
2. **Check edge function logs** for errors
3. **Verify domain** in user's profile settings
4. **Check user_newsletter_emails** table for correct email
5. **Check newsletter_emails** for processing_status

### AI Generation Failing

1. **Check AI provider** in user's profile
2. **Verify API key** is valid and has credits
3. **Check edge function logs** for API errors
4. **Test with Lovable AI** (remove custom config)

### SPA Routing "Not Found" Errors

If refreshing pages shows "Not Found":
1. Go to Render Dashboard → Your Site → Settings
2. Add Rewrite Rule: `/*` → `/index.html`
3. Trigger a redeploy

---

## Database Migration Reference

If setting up a fresh Supabase project, here are key migrations:

### Newsletter System Tables

```sql
-- Add newsletter_domain to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS newsletter_domain TEXT;

-- Create user_newsletter_emails
CREATE TABLE IF NOT EXISTS user_newsletter_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email_prefix TEXT NOT NULL,
  email_address TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- SECURITY: Unique constraint prevents duplicate email prefixes
  CONSTRAINT email_prefix_unique UNIQUE (email_prefix)
);

ALTER TABLE user_newsletter_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own newsletter email"
ON user_newsletter_emails FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own newsletter email"
ON user_newsletter_emails FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create newsletter_emails log
CREATE TABLE IF NOT EXISTS newsletter_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  from_address TEXT,
  subject TEXT,
  reference_card_id UUID REFERENCES reference_cards(id),
  processing_status TEXT DEFAULT 'pending',
  received_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE newsletter_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own newsletter emails"
ON newsletter_emails FOR SELECT
USING (auth.uid() = user_id);
```

### Source Type Constraint Update

```sql
-- Ensure 'newsletter' and 'pdf' are valid source types
ALTER TABLE reference_cards 
DROP CONSTRAINT IF EXISTS reference_cards_source_type_check;

ALTER TABLE reference_cards 
ADD CONSTRAINT reference_cards_source_type_check 
CHECK (source_type IN ('rss', 'manual', 'newsletter', 'pdf', 'observation', 'journal'));
```

---

## Support Contacts

| Issue Type | Contact |
|------------|---------|
| Application bugs | [DEVELOPER EMAIL - Replace before handoff] |
| Mailgun issues | [IT TEAM EMAIL - Replace before handoff] |
| AI provider billing | Direct with Google/OpenAI |
| General support | [SUPPORT EMAIL - Replace before handoff] |

---

## Appendix: Project Configuration

> **Note:** Replace all placeholder values with your production project details before handoff.

| Item | Value |
|------|-------|
| Project ID | `[YOUR-PROJECT-ID]` |
| Region | [CHECK DASHBOARD] |
| API URL | `https://[YOUR-PROJECT-ID].supabase.co` |
| Anon Key | [YOUR ANON KEY] |

**Development Instance (for reference):**
- Project ID: `xtaslgxrgzksojtoekmz`
- This was used during development and should NOT be used in production.
