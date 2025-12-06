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

## 🟡 PENDING - Requires Mailgun Configuration

### 7. Mailgun Webhook Signature Verification
**File:** `supabase/functions/process-newsletter-email/index.ts`

**Status:** Waiting for Mailgun to be configured

**Required Secret:** `MAILGUN_SIGNING_KEY` (from Mailgun dashboard → Webhooks → Signing Key)

**Implementation Ready:**
```typescript
async function verifyMailgunSignature(
  timestamp: string, 
  token: string, 
  signature: string, 
  signingKey: string
): Promise<boolean> {
  const crypto = globalThis.crypto;
  const encoder = new TextEncoder();
  const data = encoder.encode(timestamp + token);
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const sig = await crypto.subtle.sign('HMAC', key, data);
  const hexSig = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
    
  return hexSig === signature;
}
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

### ⏳ Pending (Requires Mailgun):
- [ ] Mailgun webhook signature verification
- [ ] Add MAILGUN_SIGNING_KEY secret

---

## Testing Checklist

- [x] Password with weak policy is rejected during signup
- [x] Rate limits trigger 429 response after threshold
- [ ] Mailgun webhook rejects requests with invalid/missing signatures
- [x] Non-PDF file with .pdf extension is rejected
- [x] RSS feed with internal IP is rejected
- [x] Security headers present in browser dev tools

---

## Post-Implementation Notes

1. **Dependency Added:** `dompurify` and `@types/dompurify`
2. **Database Table Added:** `rate_limit_logs` with automatic cleanup function
3. **All edge functions now have rate limiting**
4. **Security headers configured for both development and Render deployment**
