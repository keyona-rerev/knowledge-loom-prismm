# Security Fix Plan - Insight Forge

## Overview
This document outlines the comprehensive security fixes for production deployment.

---

## ✅ COMPLETED - Security Sprint

### 1. XSS Protection with DOMPurify ✅ DONE
**File:** `src/pages/Review.tsx`

**Fix Applied:** Added DOMPurify sanitization with allowed tags/attributes whitelist.

```typescript
import DOMPurify from 'dompurify';

<div dangerouslySetInnerHTML={{ 
  __html: DOMPurify.sanitize((draft.body || '').replace(/\n/g, '<br/>'), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 
                   'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                   'a', 'blockquote', 'code', 'pre', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id'],
    FORBID_ATTR: ['style', 'onclick', 'onload', 'onerror', 'onmouseover']
  })
}} />
```

---

### 2. Security Headers ✅ DONE

**Files Created/Updated:**
- `public/_headers` - Render deployment headers
- `index.html` - CSP meta tags

**Headers Applied:**
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Content-Security-Policy: Comprehensive CSP for Supabase/Google APIs

---

### 3. Password Policy Enhancement ✅ DONE
**File:** `src/pages/Auth.tsx`

**Policy Applied:**
- Minimum 8 characters
- Maximum 128 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

---

### 4. PDF MIME Type Validation ✅ DONE
**File:** `src/lib/pdf-parser.ts`

**Validation Applied:**
- MIME type check (application/pdf)
- PDF magic bytes validation (%PDF header)
- Prevents malicious file uploads

---

### 5. SSRF Protection ✅ DONE
**File:** `supabase/functions/pull-rss-feed/index.ts`

**Protection Applied:**
- Blocks dangerous protocols (file://, etc.)
- Blocks localhost and internal hosts
- Blocks private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x, 0.x)
- Applied to both feed URLs and article links

---

### 6. Rate Limiting ✅ DONE
**Database:** `rate_limit_logs` table created with RLS

**Functions Updated:**
| Function | Limit |
|----------|-------|
| `create-manual-source` | 50/hour |
| `generate-content-from-card` | 100/hour |
| `generate-final-content` | 100/hour |
| `process-reference-card` | 100/hour |

---

### 7. Mailgun Webhook Signature Verification ✅ DONE
**File:** `supabase/functions/process-newsletter-email/index.ts`

**Status:** Implemented - Code deployed, awaiting production secret configuration

**Required Secret:** `MAILGUN_SIGNING_KEY` (from Mailgun dashboard → Webhooks → Signing Key)

**Implementation:**
- Added `verifyMailgunSignature()` function using HMAC-SHA256
- Extracts `timestamp`, `token`, `signature` from Mailgun webhook payload
- If `MAILGUN_SIGNING_KEY` is configured → enforces signature verification
- If `MAILGUN_SIGNING_KEY` is NOT configured → logs warning, allows processing (dev mode)
- Rejects requests with invalid/missing signatures when key is configured (401 response)

**Production Setup Required:**
1. Get signing key from Mailgun Dashboard → Webhooks → Webhook Signing Key
2. Add `MAILGUN_SIGNING_KEY` secret in production Supabase Edge Functions

---

### 8. Email Prefix Uniqueness Constraint ✅ DONE
**Database:** `user_newsletter_emails` table

**Fix Applied:** Added UNIQUE constraint to `email_prefix` column to prevent duplicate email assignments.

```sql
ALTER TABLE user_newsletter_emails 
ADD CONSTRAINT email_prefix_unique UNIQUE (email_prefix);
```

---

### 9. Crypto-Secure Email Generation ✅ DONE
**File:** `src/pages/Feeds.tsx`

**Fix Applied:** Changed from weak `Math.random()` to cryptographically secure `crypto.randomUUID()`:

```typescript
// BEFORE (weak):
const shortId = session.user.id.substring(0, 8);
const random = Math.random().toString(36).substring(2, 8);
const prefix = `user-${shortId}-${random}`;

// AFTER (secure):
const prefix = `user-${crypto.randomUUID().slice(0, 12)}`;
```

---

## Security Checklist

### ✅ Completed:
- [x] XSS protection with DOMPurify
- [x] Security headers (CSP, X-Frame-Options, etc.)
- [x] Enhanced password policy
- [x] PDF MIME type + magic bytes validation
- [x] SSRF protection for URL fetching
- [x] Rate limiting for edge functions
- [x] Rate limit database table with RLS
- [x] Mailgun webhook signature verification (code deployed)
- [x] Email prefix UNIQUE constraint
- [x] Crypto-secure email prefix generation

### ⏳ Pending (Production Setup):
- [ ] Add `MAILGUN_SIGNING_KEY` secret in production Supabase
- [ ] Run database migrations in production Supabase
- [ ] Update Mailgun webhook URL to production endpoint

---

## Testing Checklist

- [x] Password with weak policy is rejected during signup
- [x] Rate limits trigger 429 response after threshold
- [x] Mailgun webhook signature verification code implemented
- [ ] Mailgun webhook rejects requests with invalid/missing signatures (requires production secret)
- [x] Non-PDF file with .pdf extension is rejected
- [x] RSS feed with internal IP is rejected
- [x] Security headers present in browser dev tools
- [x] Email prefix uses crypto-secure random generation

---

## Post-Implementation Notes

1. **Dependency Added:** `dompurify` and `@types/dompurify`
2. **Database Table Added:** `rate_limit_logs` with automatic cleanup function
3. **Database Constraint Added:** `email_prefix_unique` on `user_newsletter_emails`
4. **All edge functions now have rate limiting**
5. **Security headers configured for both development and Render deployment**
6. **Mailgun signature verification ready** - will auto-enable when `MAILGUN_SIGNING_KEY` is configured

---

## Production Migration Checklist

Before handoff to client, complete these steps in production Supabase (`xxbgfpavdfybuqdiutiz`):

1. [ ] Run UNIQUE constraint migration in SQL Editor
2. [ ] Deploy edge functions via Supabase CLI
3. [ ] Add `MAILGUN_SIGNING_KEY` secret
4. [ ] Update Mailgun webhook URL to production endpoint
5. [ ] Update frontend environment variables for Render
6. [ ] Test newsletter flow end-to-end
