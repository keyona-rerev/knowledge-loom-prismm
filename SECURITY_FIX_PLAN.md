# Security Fix Plan - Insight Forge

## Overview
This document outlines the comprehensive security fixes required for production deployment.

---

## 🔴 CRITICAL Priority Fixes

### 1. Mailgun Webhook Signature Verification
**File:** `supabase/functions/process-newsletter-email/index.ts`

**Current State:** Webhook accepts any request without verifying Mailgun signature.

**Risk:** Attackers could send fake emails to create spam reference cards or exhaust rate limits.

**Fix Required:**
```typescript
// Add at the top of the function
function verifyMailgunSignature(
  timestamp: string, 
  token: string, 
  signature: string, 
  signingKey: string
): boolean {
  const crypto = globalThis.crypto;
  const encoder = new TextEncoder();
  const data = encoder.encode(timestamp + token);
  
  // Use Web Crypto API for HMAC-SHA256
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  ).then(key => 
    crypto.subtle.sign('HMAC', key, data)
  ).then(sig => {
    const hexSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hexSig === signature;
  });
}
```

**Secret Required:** `MAILGUN_SIGNING_KEY` (from Mailgun dashboard → Webhooks → Signing Key)

---

### 2. XSS Protection with DOMPurify
**File:** `src/pages/Review.tsx` (lines 490-500)

**Current State:** Uses `dangerouslySetInnerHTML` without sanitization.

**Risk:** Stored XSS attacks via malicious content in draft bodies.

**Fix Required:**
```typescript
import DOMPurify from 'dompurify';

// Replace:
<div dangerouslySetInnerHTML={{ __html: draft.body }} />

// With:
<div dangerouslySetInnerHTML={{ 
  __html: DOMPurify.sanitize(draft.body, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel']
  }) 
}} />
```

**Dependencies Required:** `dompurify`, `@types/dompurify`

---

## 🟠 HIGH Priority Fixes

### 3. Rate Limiting for Edge Functions
**Files:** All edge functions

**Current State:** Only `process-newsletter-email` has rate limiting.

**Functions Needing Rate Limits:**
- `process-reference-card`: 100/hour per user
- `generate-content-from-card`: 50/hour per user  
- `generate-content-directions`: 50/hour per user
- `generate-final-content`: 30/hour per user
- `regenerate-draft-with-feedback`: 20/hour per user

**Implementation Pattern:**
```typescript
// Reusable rate limit check
async function checkRateLimit(
  supabase: any, 
  userId: string, 
  table: string, 
  limit: number, 
  windowMs: number = 3600000
): Promise<{ allowed: boolean; current: number }> {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  
  const { count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', windowStart);
    
  return { 
    allowed: (count || 0) < limit, 
    current: count || 0 
  };
}
```

---

### 4. PDF MIME Type Validation
**File:** `src/lib/pdf-parser.ts`

**Current State:** Only checks file extension, not actual MIME type.

**Risk:** Malicious files disguised as PDFs.

**Fix Required:**
```typescript
// Add MIME type validation
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46]; // %PDF

export async function validatePDFFile(file: File): Promise<boolean> {
  // Check MIME type
  if (file.type !== 'application/pdf') {
    return false;
  }
  
  // Check magic bytes
  const arrayBuffer = await file.slice(0, 4).arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  return PDF_MAGIC_BYTES.every((byte, i) => bytes[i] === byte);
}

export async function parsePDF(file: File): Promise<PDFParseResult> {
  // Validate before parsing
  const isValid = await validatePDFFile(file);
  if (!isValid) {
    throw new Error('Invalid PDF file: File does not appear to be a valid PDF');
  }
  
  // ... existing parsing logic
}
```

---

### 5. SSRF Protection for URL Fetching
**File:** `supabase/functions/pull-rss-feed/index.ts`

**Current State:** Fetches any URL without validation.

**Risk:** Server-Side Request Forgery - attackers could use the server to probe internal networks.

**Fix Required:**
```typescript
// URL validation function
function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Block internal/private IP ranges
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^0\./,
      /^::1$/,
      /^fc00:/i,
      /^fe80:/i,
    ];
    
    // Block file:// and other dangerous protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    // Check hostname against blocked patterns
    const hostname = parsed.hostname;
    if (blockedPatterns.some(pattern => pattern.test(hostname))) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

// Use before any fetch
if (!isAllowedUrl(feed.url)) {
  return new Response(
    JSON.stringify({ error: "URL not allowed for security reasons" }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

---

### 6. Security Headers
**File:** `index.html` (via meta tags) + Render deployment config

**Current State:** No security headers configured.

**Fix for index.html:**
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self';
  connect-src 'self' https://*.supabase.co wss://*.supabase.co;
  frame-ancestors 'none';
">
<meta http-equiv="X-Content-Type-Options" content="nosniff">
<meta http-equiv="X-Frame-Options" content="DENY">
<meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
```

**For Render deployment (`public/_headers`):**
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## Implementation Order

1. **Mailgun Webhook Verification** - Prevents spam/abuse
2. **XSS Protection** - Prevents stored XSS attacks
3. **SSRF Protection** - Prevents internal network probing
4. **PDF Validation** - Prevents malicious file uploads
5. **Rate Limiting** - Prevents API abuse
6. **Security Headers** - Defense in depth

---

## Required Secrets

| Secret Name | Source | Purpose |
|-------------|--------|---------|
| MAILGUN_SIGNING_KEY | Mailgun Dashboard → Webhooks | Verify webhook authenticity |

---

## Testing Checklist

- [ ] Mailgun webhook rejects requests with invalid/missing signatures
- [ ] XSS payload in draft body is sanitized
- [ ] RSS feed with internal IP (127.0.0.1) is rejected
- [ ] Non-PDF file with .pdf extension is rejected
- [ ] Rate limits trigger 429 response after threshold
- [ ] Security headers present in browser dev tools

---

## Post-Implementation Verification

```bash
# Check security headers
curl -I https://your-app.onrender.com

# Test Mailgun webhook rejection
curl -X POST https://your-app.supabase.co/functions/v1/process-newsletter-email \
  -H "Content-Type: application/json" \
  -d '{"recipient":"test@example.com"}'
# Should return 401 Unauthorized
```
