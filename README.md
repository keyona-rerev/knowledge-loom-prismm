# Content Creation Platform - Deployment Guide

A full-stack content creation platform that helps you generate, manage, and schedule content using AI-powered insights from reference materials.

## 🚀 Features

- **Reference Card Management**: Store and organize reference materials (articles, RSS feeds, manual sources)
- **AI-Powered Insights**: Extract key insights from reference materials
- **Content Generation**: Create drafts from reference cards with customizable templates
- **Content Calendar**: Schedule and manage your content pipeline
- **Autopilot Templates**: Automate content creation workflows
- **Customizable Settings**: Configure AI providers, writing examples, and business context

## 📋 Prerequisites

Before deploying, ensure you have:

- A [GitHub](https://github.com) account
- A [Supabase](https://supabase.com) account
- A [Render](https://render.com) account
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (for database migrations)
- [Git](https://git-scm.com/) installed locally

## 🗄️ Database Setup (Supabase)

### Step 1: Create a New Supabase Project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Click "New Project"
3. Fill in project details:
   - **Name**: Choose a name (e.g., "content-platform")
   - **Database Password**: Generate a strong password (save this!)
   - **Region**: Choose closest to your users
4. Wait for project to be created (2-3 minutes)

### Step 2: Save Your Credentials

Once created, navigate to **Project Settings → API** and note:

- **Project URL**: `https://xxxxxxxxxx.supabase.co`
- **Project ID**: `xxxxxxxxxx` (from the URL)
- **anon/public key**: `eyJhbG...` (starts with eyJ)
- **service_role key**: `eyJhbG...` (different key, keep secret!)

### Step 3: Run Database Migrations

Option A: **Using Supabase CLI (Recommended)**

```bash
# Clone your repository
git clone <your-repo-url>
cd <your-repo-name>

# Link to your Supabase project
supabase link --project-ref <your-project-id>

# Enter your database password when prompted

# Push all migrations to Supabase
supabase db push
```

Option B: **Manual Migration via Dashboard**

1. Go to **SQL Editor** in Supabase Dashboard
2. Run each migration file in `supabase/migrations/` in chronological order
3. Files are named with timestamps - run them in order from oldest to newest

### Step 4: Deploy Edge Functions

```bash
# Deploy all functions at once
supabase functions deploy generate-content-directions
supabase functions deploy generate-content-from-card
supabase functions deploy generate-final-content
supabase functions deploy process-reference-card
supabase functions deploy pull-rss-feed
supabase functions deploy create-manual-source
supabase functions deploy execute-autopilot-template
supabase functions deploy send-draft-notification
supabase functions deploy regenerate-draft-with-feedback
```

Or deploy all at once:
```bash
supabase functions deploy
```

### Step 5: Configure Authentication

1. Go to **Authentication → Providers** in Supabase Dashboard
2. Enable **Email** provider
3. Go to **Authentication → Settings**
4. **Disable** "Enable email confirmations" (for easier testing)
5. Set **Site URL** to your Render app URL (update after deployment)
6. Add **Redirect URLs**:
   - `https://your-app.onrender.com/**` (update with your actual URL)
   - `http://localhost:8080/**` (for local development)

## 🤖 AI Configuration

This app uses **Lovable AI** by default, which requires a `LOVABLE_API_KEY`.

### Option 1: Use Lovable AI (Recommended)

1. Contact Lovable support to get an API key: support@lovable.dev
2. Set the secret in Supabase:

```bash
supabase secrets set LOVABLE_API_KEY=your_lovable_api_key_here
```

### Option 2: Use Google AI (Alternative)

If you prefer Google AI:

1. Get a Google AI API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Users can configure it in the app's Settings page
3. The key is stored securely in the database per-user

### Option 3: Use Custom AI Endpoint (Advanced)

Configure a custom OpenAI-compatible endpoint in the app's Settings page.

## 🚀 Deploy to Render

### Step 1: Update Configuration Files

Before pushing to GitHub, update `supabase/config.toml`:

```toml
project_id = "your_actual_project_id"

[functions.pull-rss-feed]
verify_jwt = false

[functions.create-manual-source]
verify_jwt = false

[functions.process-reference-card]
verify_jwt = false

[functions.generate-content-directions]
verify_jwt = false

[functions.generate-final-content]
verify_jwt = false

[functions.execute-autopilot-template]
verify_jwt = false

[functions.generate-content-from-card]
verify_jwt = false

[functions.send-draft-notification]
verify_jwt = false

[functions.regenerate-draft-with-feedback]
verify_jwt = false
```

### Step 2: Push to GitHub

```bash
git add .
git commit -m "Update configuration for deployment"
git push origin main
```

### Step 3: Create Render Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New → Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `content-platform` (or your choice)
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run preview`
   - **Instance Type**: Choose based on needs (Free tier available)

### Step 4: Add Environment Variables

In Render → Environment, add:

| Key | Value | Example |
|-----|-------|---------|
| `VITE_SUPABASE_URL` | Your Supabase project URL | `https://xxxxxxxxxx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your anon/public key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `VITE_SUPABASE_PROJECT_ID` | Your project ID | `xxxxxxxxxx` |

### Step 5: Deploy

Click **Create Web Service** and wait for deployment (5-10 minutes).

### Step 6: Update Supabase Redirect URLs

Once deployed:

1. Copy your Render app URL (e.g., `https://your-app.onrender.com`)
2. Go to Supabase Dashboard → **Authentication → URL Configuration**
3. Update:
   - **Site URL**: `https://your-app.onrender.com`
   - Add to **Redirect URLs**: `https://your-app.onrender.com/**`

## 🧪 Post-Deployment Testing

Test these workflows:

### 1. Authentication
- [ ] Sign up with email
- [ ] Log in
- [ ] Log out

### 2. Settings Configuration
- [ ] Update business profile
- [ ] Add writing examples
- [ ] Configure AI provider (if using custom)
- [ ] Set up question sets

### 3. Reference Cards
- [ ] Add RSS feed source
- [ ] Create manual source
- [ ] Process reference card
- [ ] View AI insights

### 4. Content Creation
- [ ] Generate content directions from card
- [ ] Create draft from reference card
- [ ] Generate final content
- [ ] Review and edit draft

### 5. Calendar
- [ ] View calendar
- [ ] Schedule draft
- [ ] Move scheduled content

### 6. Autopilot
- [ ] Create autopilot template
- [ ] Execute autopilot template
- [ ] View generated content

## 🏗️ Architecture Overview

```
Frontend (React + Vite)
    ↓
Supabase Client SDK
    ↓
┌─────────────────────────────────┐
│   Supabase Backend              │
│                                 │
│  ┌─────────────────────┐       │
│  │  PostgreSQL DB       │       │
│  │  - profiles          │       │
│  │  - reference_cards   │       │
│  │  - drafts            │       │
│  │  - source_feeds      │       │
│  │  - etc.              │       │
│  └─────────────────────┘       │
│                                 │
│  ┌─────────────────────┐       │
│  │  Edge Functions      │       │
│  │  - Content Gen       │       │
│  │  - RSS Processing    │       │
│  │  - AI Integration    │       │
│  └─────────────────────┘       │
│                                 │
│  ┌─────────────────────┐       │
│  │  Authentication      │       │
│  │  - Email Auth        │       │
│  │  - RLS Policies      │       │
│  └─────────────────────┘       │
└─────────────────────────────────┘
         ↓
   Lovable AI Gateway
   (or Google AI)
```

## 🔒 Security Notes

- **Row Level Security (RLS)** is enabled on all tables
- Users can only access their own data
- API keys are stored encrypted in the database
- Edge functions validate user authentication
- Service role key should NEVER be exposed to frontend

## 📝 Environment Variables Reference

### Frontend (.env)
```bash
VITE_SUPABASE_URL=https://xxxxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbG...
VITE_SUPABASE_PROJECT_ID=xxxxxxxxxx
```

### Supabase Secrets (for Edge Functions)
```bash
LOVABLE_API_KEY=your_lovable_api_key
SUPABASE_URL=https://xxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG... (auto-provided)
SUPABASE_DB_URL=postgresql://... (auto-provided)
```

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Access at http://localhost:8080
```

## 🐛 Troubleshooting

### Authentication Errors

**Error**: "requested path is invalid"
- **Fix**: Check Site URL and Redirect URLs in Supabase Auth settings

**Error**: Redirects to localhost
- **Fix**: Update Site URL to your production URL

### Edge Function Errors

**Error**: "Function not found"
- **Fix**: Deploy edge functions: `supabase functions deploy`

**Error**: "LOVABLE_API_KEY not found"
- **Fix**: Set secret: `supabase secrets set LOVABLE_API_KEY=your_key`

### Database Errors

**Error**: "relation does not exist"
- **Fix**: Run all migrations: `supabase db push`

**Error**: "permission denied"
- **Fix**: Check RLS policies are properly configured

### Build Errors on Render

**Error**: Build fails
- **Fix**: Ensure Node version is compatible (check package.json engines)
- **Fix**: Clear Render cache and redeploy

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Render Documentation](https://render.com/docs)
- [Vite Documentation](https://vitejs.dev)
- [React Documentation](https://react.dev)

## 💰 Cost Estimates

### Supabase (Free Tier)
- 500MB database
- 1GB file storage
- 2GB bandwidth
- 50,000 monthly active users
- **Upgrade**: $25/month for Pro

### Render (Free Tier)
- 750 hours/month
- Spins down after 15 min inactivity
- **Upgrade**: $7/month for always-on

### Lovable AI
- Pay-as-you-go pricing
- Contact support@lovable.dev for pricing
- **Alternative**: Use Google AI (free tier available)

## 🤝 Support

For issues or questions:
- Check the troubleshooting section above
- Review Supabase logs in Dashboard → Logs
- Check Render logs in Dashboard → Logs

## 📄 License

[Your License Here]

---

**Built with**: React, TypeScript, Vite, Supabase, Tailwind CSS, shadcn/ui