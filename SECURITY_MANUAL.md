# Security Configuration Manual

This document covers security settings that require manual configuration outside of the codebase. These settings should be configured by the IT team after deployment.

---

## Table of Contents

1. [Session Timeout Configuration](#1-session-timeout-configuration)
2. [Dependency Security](#2-dependency-security)
3. [Data Retention Cron Job](#3-data-retention-cron-job)
4. [RLS Policy Audit Summary](#4-rls-policy-audit-summary)

---

## 1. Session Timeout Configuration

### Current Default
Supabase's default JWT expiry is **3600 seconds (1 hour)** for access tokens with refresh token rotation enabled.

### Recommended Settings
For production applications, we recommend:
- **Access Token Expiry**: 3600 seconds (1 hour)
- **Refresh Token Rotation**: Enabled
- **Refresh Token Reuse Interval**: 10 seconds

### How to Configure

1. Log into your Supabase Dashboard
2. Navigate to **Authentication → Providers → Email**
3. Scroll down to **JWT Settings**
4. Configure:
   - `JWT expiry limit`: 3600 (seconds)
   - Enable `Refresh Token Rotation`
   - Set `Reuse Interval`: 10 seconds

### Documentation
- [Supabase JWT Settings](https://supabase.com/docs/guides/auth/sessions)

---

## 2. Dependency Security

### npm Audit

Run security audits regularly:

```bash
# Check for vulnerabilities
npm audit

# Automatically fix vulnerabilities (use with caution)
npm audit fix

# Generate a detailed report
npm audit --json > audit-report.json
```

### Lock Dependency Versions

To prevent unexpected updates, remove version prefixes from `package.json`:

```json
// Before (allows updates)
"react": "^18.3.1"

// After (locked version)
"react": "18.3.1"
```

**Note:** This is a trade-off between security (getting patches) and stability. For production handoff, locked versions provide more predictability.

### GitHub Dependabot

Enable Dependabot for automated security updates:

1. Go to your GitHub repository
2. Navigate to **Settings → Security → Code security and analysis**
3. Enable:
   - **Dependency graph**: ✓
   - **Dependabot alerts**: ✓
   - **Dependabot security updates**: ✓

Alternatively, create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    target-branch: "main"
```

---

## 3. Data Retention Cron Job

The `cleanup-old-emails` edge function archives newsletter emails older than 90 days. To run it automatically:

### Option A: Supabase Cron (pg_cron)

Run this SQL in your Supabase SQL Editor:

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule cleanup to run daily at 3 AM UTC
SELECT cron.schedule(
  'cleanup-old-emails-daily',
  '0 3 * * *', -- Every day at 3:00 AM UTC
  $$
  SELECT net.http_post(
    url := 'https://xtaslgxrgzksojtoekmz.supabase.co/functions/v1/cleanup-old-emails',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

**Important**: Replace `YOUR_SERVICE_ROLE_KEY` with your actual service role key.

### Option B: External Cron Service

Use services like:
- **Render Cron Jobs** (if deployed on Render)
- **AWS CloudWatch Events**
- **GitHub Actions Scheduled Workflows**

Example GitHub Actions workflow:

```yaml
# .github/workflows/cleanup-cron.yml
name: Email Cleanup Cron

on:
  schedule:
    - cron: '0 3 * * *' # Daily at 3 AM UTC

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger cleanup
        run: |
          curl -X POST \
            'https://xtaslgxrgzksojtoekmz.supabase.co/functions/v1/cleanup-old-emails' \
            -H 'Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}' \
            -H 'Content-Type: application/json'
```

---

## 4. RLS Policy Audit Summary

All Row-Level Security policies have been reviewed. Here's the summary:

### ✅ Properly Secured Tables

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
|-------|--------|--------|--------|--------|-------|
| `profiles` | auth.uid() = user_id | ✓ | ✓ | ✗ (intentional) | Users can't delete their profile |
| `reference_cards` | auth.uid() = user_id | ✓ | ✓ | ✓ | Full CRUD for own cards |
| `drafts` | auth.uid() = user_id | ✓ | ✓ | ✓ | Full CRUD for own drafts |
| `source_feeds` | auth.uid() = user_id | ✓ | ✓ | ✓ | Full CRUD for own feeds |
| `autopilot_templates` | auth.uid() = user_id | ✓ | ✓ | ✓ | Full CRUD |
| `content_calendar` | auth.uid() = user_id | ✓ | ✓ | ✓ | Full CRUD |
| `insight_cards` | auth.uid() = user_id | ✓ | ✓ | ✓ | Full CRUD |
| `question_sets` | auth.uid() = user_id | ✓ | ✓ | ✓ | Full CRUD |
| `reference_card_templates` | auth.uid() = user_id | ✓ | ✓ | ✓ | Full CRUD |
| `user_newsletter_emails` | auth.uid() = user_id | ✓ | ✓ | ✗ | No DELETE (use edge function) |
| `newsletter_emails` | auth.uid() = user_id | ✗ | ✗ | ✗ | SELECT only (service inserts) |
| `email_notifications` | auth.uid() = user_id | ✓ | ✓ | ✗ | No DELETE (audit trail) |
| `draft_revisions` | via drafts.user_id | ✓ | ✗ | ✗ | Audit trail, no update/delete |
| `insight_ratings` | via drafts.user_id | ✓ | ✗ | ✗ | Immutable ratings |
| `rate_limit_logs` | service_role only | - | - | - | System table |

### Tables with Special Access Patterns

1. **`content_templates`**: 
   - SELECT allows viewing own templates OR system templates (is_system_template = true)
   - This is intentional to provide default templates

2. **`question_sets`**: 
   - SELECT allows viewing own sets OR global sets (is_global = true)
   - This is intentional for shared question sets

3. **`newsletter_emails`**: 
   - Users can only SELECT their own emails
   - INSERTs are done by the webhook edge function (service role)
   - No client-side INSERT/UPDATE/DELETE - this is correct

### Verification Commands

To verify RLS is enabled and policies are active:

```sql
-- Check RLS is enabled on all public tables
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- View all policies
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

---

## Security Checklist for Deployment

Before going live:

- [ ] MAILGUN_SIGNING_KEY secret is set in production Supabase
- [ ] Session timeout is configured (see Section 1)
- [ ] npm audit shows no high/critical vulnerabilities
- [ ] Dependabot is enabled (see Section 2)
- [ ] Data retention cron job is scheduled (see Section 3)
- [ ] All RLS policies verified (see Section 4)
- [ ] Test webhook signature verification is working
- [ ] Test rate limiting is working
- [ ] Test user data deletion is working

---

## Security Contact

For security-related questions or to report vulnerabilities:
- Email: [SECURITY_CONTACT_EMAIL]
- Response time: 24-48 hours for critical issues
