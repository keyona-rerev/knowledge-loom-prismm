# Insight Forge - User Guide

**Welcome to Insight Forge!** Transform newsletters, articles, and observations into AI-powered reference material and polished blog post drafts.

---

## 📺 Video Walkthrough

[LOOM VIDEO PLACEHOLDER - Complete App Overview]

---

## Table of Contents

1. [What Insight Forge Does](#what-insight-forge-does)
2. [Dashboard Navigation](#dashboard-navigation)
3. [Setting Up Content Sources](#setting-up-content-sources)
4. [Question Settings](#question-settings)
5. [Observation Journal](#observation-journal)
6. [Reference Cards](#reference-cards)
7. [Creating Content](#creating-content)
8. [Managing Drafts](#managing-drafts)
9. [Automation with Autopilot](#automation-with-autopilot)
10. [Review Queue](#review-queue)
11. [Content Calendar](#content-calendar)
12. [Settings Configuration](#settings-configuration)
13. [Troubleshooting](#troubleshooting)
14. [Quick Reference](#quick-reference)

---

## What Insight Forge Does

Insight Forge is your content intelligence hub. It aggregates content from multiple sources, analyzes it with AI, and helps you create original blog posts.

**The Workflow:**

```
Content Sources → AI Analysis → Reference Cards → Content Creation → Drafts → Calendar
```

1. **Gather Content** - Subscribe newsletters, add URLs, upload PDFs, or capture observations
2. **AI Processing** - Each piece of content becomes a "Reference Card" with AI-generated insights
3. **Create Drafts** - Generate blog posts using your reference cards as source material
4. **Review & Schedule** - Approve drafts and schedule them on your content calendar

**Content Sources Supported:**
- 📧 **Newsletters** - Auto-captured via your unique email address
- 🔗 **URLs** - Paste any article link
- 📄 **PDFs** - Upload documents (up to 50 pages)
- 💡 **Observations** - Manually capture your own insights

---

## Dashboard Navigation

[LOOM VIDEO PLACEHOLDER - Dashboard Tour]

### Hub-Based Navigation

Insight Forge uses a **hub-based dashboard** (not a persistent sidebar). Click cards to navigate to different sections.

### Dashboard Sections

**Getting Started:**
- Add Content Source → `/sources`
- Configure Questions → `/questions`

**Your Content:**
- Reference Cards → `/cards`
- Observation Journal → `/insights`

**Automation:**
- Autopilot Templates → `/autopilot`
- Review Queue → `/review`

**Content:**
- Create Content → `/create`
- Your Drafts → `/drafts`
- Content Calendar → `/calendar`

**Configuration:**
- Settings → `/settings`

### At a Glance Stats

The dashboard shows real-time counts:
- Active Reference Cards
- Pending Drafts (awaiting review)
- Scheduled Posts

---

## Setting Up Content Sources

[LOOM VIDEO PLACEHOLDER - Adding Content Sources]

Navigate to **Sources** from the dashboard.

### Newsletter Inbox Tab

**Prerequisites:** Your IT team must configure Mailgun first (see Technical Handoff). Then set your newsletter domain in Settings.

**Setup Steps:**

1. Go to **Settings** → scroll to **Newsletter Email Configuration**
2. Enter your newsletter domain (e.g., `newsletters.yourbusiness.com`)
3. Save settings
4. Go to **Sources** → **Newsletter Inbox** tab
5. Your unique email appears automatically (e.g., `user-abc123-xyz@newsletters.yourbusiness.com`)
6. Click **Copy** to copy your email
7. Use this email when subscribing to newsletters

**How It Works:**
- When a newsletter arrives, it's automatically converted to a Reference Card
- AI processes the content and extracts insights
- Cards appear in your Reference Cards section

**Rate Limit:** 50 emails per hour (spam protection)

### Manual Sources Tab

**Adding a URL:**

1. Go to **Sources** → **Manual Sources** tab
2. Click **URL** option
3. Paste the article URL
4. (Optional) Select a Question Set to apply
5. Click **Add Source**

**Uploading a PDF:**

1. Go to **Sources** → **Manual Sources** tab
2. Click **PDF** option
3. Upload your PDF file (max 50 pages, 50,000 characters)
4. (Optional) Select a Question Set
5. Click **Add Source**

---

## Question Settings

[LOOM VIDEO PLACEHOLDER - Configuring Questions]

Navigate to **Configure Questions** from the dashboard or go to `/questions`.

### What Are Question Sets?

Question Sets define what insights the AI extracts from your content. When content is processed, the AI answers each question in the set.

**Default Questions Include:**
- What are the key takeaways?
- How credible is this source?
- What potential biases are present?
- What is the main argument or finding?

### Creating a Custom Question Set

1. Go to **Question Settings**
2. Click **Create New Question Set**
3. Enter a name (e.g., "Marketing Analysis")
4. Add your custom questions:
   - "What marketing tactics are mentioned?"
   - "What audience segments are targeted?"
   - "What's the competitive angle?"
5. Save the question set

### Using Question Sets

- **On Manual Sources:** Select a question set when adding URLs/PDFs
- **On Autopilot Templates:** Assign a question set to automated content
- **Global Default:** Set a default question set in Settings

---

## Observation Journal

[LOOM VIDEO PLACEHOLDER - Capturing Observations]

Navigate to **Observation Journal** from the dashboard or go to `/insights`.

### What Is the Observation Journal?

Capture your own insights, ideas, and observations that can later become content. Think of it as a smart notepad connected to your content pipeline.

### Creating an Observation

1. Go to **Observation Journal**
2. Click **New Insight**
3. Fill in:
   - **Title** - Brief description
   - **Content** - Your full thought/observation
   - **Type** - Choose from:
     - 💡 Observation (general insight)
     - 📝 Thesis (main argument)
     - 🎣 Hook (attention-grabber)
     - 🔄 Contrarian (opposing view)
     - 🎯 Closing (conclusion point)
   - **Tags** - Add keywords
   - **Priority** - 1-5 scale
4. Save

### Converting to Reference Card

Want to use an observation in content creation?

1. Open the observation
2. Click **Convert to Reference Card**
3. (Optional) Select a question set
4. The observation becomes a reference card you can use in drafts

---

## Reference Cards

[LOOM VIDEO PLACEHOLDER - Managing Reference Cards]

Navigate to **Reference Cards** from the dashboard or go to `/cards`.

### Understanding Reference Cards

Every piece of content becomes a **Reference Card** - your AI-analyzed content library.

**Card Information:**
- **Title** - Content headline
- **Source** - Where it came from (newsletter, URL, PDF, observation)
- **AI Summary** - Generated overview
- **Insight Answers** - AI responses to your question set
- **Status** - Active, Needs Review, or Archived
- **Quality Score** - Content quality assessment

### Card Statuses

| Status | Meaning | Action |
|--------|---------|--------|
| 🟢 Active | Ready to use | Create content from it |
| 🟡 Needs Review | Requires attention | Review and update status |
| ⚫ Archived | Hidden from main view | Unarchive if needed |

### Filtering Cards

Use the filter bar to find cards:
- **By Status:** Active, Needs Review, Archived
- **By Source Type:** Newsletter, Manual, PDF, Observation

### Card Actions

**From the card list:**
- Click card to view details
- Select multiple cards with checkboxes
- Bulk delete selected cards

**From card detail view:**
- **Process with AI** - Re-run AI analysis
- **Reprocess with Different Questions** - Use a different question set
- **Ask Custom Question** - Get AI answer to a specific question
- **Archive/Unarchive** - Change status
- **Delete** - Remove permanently

### Custom Questions

On any card, you can ask additional questions:

1. Open card detail
2. Find "Ask a Custom Question" section
3. Type your question
4. Click **Ask**
5. AI answer appears and is saved to the card

---

## Creating Content

[LOOM VIDEO PLACEHOLDER - Creating Blog Posts]

Navigate to **Create Content** from the dashboard or go to `/create`.

### The Content Creation Flow

**Step 1: Enter Your Seed Insight**

Start with the core idea for your content:
- What's the main point you want to make?
- What angle are you taking?

**Step 2: Select Insight Type**

Choose how to frame your content:
- **Thesis** - Present a main argument
- **Hook** - Lead with attention-grabber
- **Contrarian** - Challenge conventional wisdom
- **Observation** - Share an insight
- **Closing** - Conclude with a strong point

**Step 3: Choose Content Template**

Select the output format:
- **LinkedIn Post** - Professional, concise (1300-1500 characters)
- **Blog Post** - Comprehensive article (1200-2000 words)
- **Case Study** - Detailed success story (1500-2500 words)

**Step 4: Generate Directions**

Click **Generate Directions** to get AI-suggested angles for your content.

**Step 5: Add Reference Cards**

Enhance your content with source material:
1. Browse your reference cards
2. Click to add relevant cards
3. The AI will incorporate insights from these sources

**Step 6: Create Draft**

Click **Create Draft** to generate your content. The AI uses:
- Your seed insight
- Selected content template
- Added reference cards
- Your business context (from Settings)
- Your writing examples (from Settings)

---

## Managing Drafts

[LOOM VIDEO PLACEHOLDER - Draft Management]

Navigate to **Your Drafts** from the dashboard or go to `/drafts`.

### Draft Overview

Your drafts page shows all generated content with:
- **Title** - Draft headline
- **Content Type** - LinkedIn, Blog, Case Study
- **Status** - Draft, Published
- **Approval Status** - Visual indicator

### Approval Statuses

| Border Color | Status | Meaning |
|--------------|--------|---------|
| 🟢 Green | Approved | Ready to schedule |
| 🟡 Yellow | Pending | Awaiting review |
| 🔴 Red | Rejected | Needs revision |

### Mini Dashboard

At the top, see counts of:
- ✅ Approved drafts
- ⏳ Pending drafts  
- ❌ Rejected drafts

### Approving/Rejecting Drafts

**From the draft card:**
- Click ✅ to approve
- Click ❌ to reject

**From draft detail view:**
1. Open the draft
2. Review the content
3. Click **Approve** or **Reject**
4. If rejecting, add feedback for revision

### Editing Drafts

1. Open draft detail
2. Edit title and body directly
3. Changes auto-save
4. Use **Regenerate** to get a new AI version

### Smart Rejection

When you reject with feedback:
1. The AI reads your feedback
2. Generates a revised version
3. New draft linked to original

---

## Automation with Autopilot

[LOOM VIDEO PLACEHOLDER - Setting Up Autopilot]

Navigate to **Autopilot Templates** from the dashboard or go to `/autopilot`.

### What Is Autopilot?

Autopilot automatically generates drafts from your reference cards on a schedule. Set it and forget it!

### Creating an Autopilot Template

1. Click **Create Template**
2. Configure:
   - **Name** - Template identifier
   - **Frequency** - Daily, Weekly, Biweekly, Monthly
   - **Content Type** - LinkedIn, Blog, Case Study
   - **Question Set** - Which questions to use
   - **Source Filters** - Limit to specific sources
   - **Approval Required** - Yes/No
3. Save template

### Template Settings

| Setting | Description |
|---------|-------------|
| Frequency | How often to generate content |
| Content Type | Output format |
| Source Feeds | Which sources to pull from |
| Topic Filters | Keywords to match |
| Approval Required | Whether drafts need review |

### Running Templates

**Automatic:** Templates run on schedule

**Manual Test:**
1. Open template
2. Click **Test Run**
3. One draft generated immediately
4. Review in Drafts section

### Enabling/Disabling

Toggle templates on/off without deleting them.

---

## Review Queue

[LOOM VIDEO PLACEHOLDER - Batch Reviewing Content]

Navigate to **Review Queue** from the dashboard or go to `/review`.

### What Is the Review Queue?

Efficiently review multiple drafts at once. Perfect for batch-approving autopilot content.

### Filtering

Filter by approval status:
- All
- Pending
- Approved
- Rejected
- Needs Revision

### Bulk Actions

1. Select multiple drafts with checkboxes
2. Click **Approve Selected** or **Reject Selected**
3. If rejecting, add bulk feedback

### Smart Rejection Flow

1. Select drafts to reject
2. Add feedback explaining what to change
3. Click **Reject with Feedback**
4. AI regenerates revised versions
5. New drafts appear with "Needs Revision" status

---

## Content Calendar

[LOOM VIDEO PLACEHOLDER - Scheduling Content]

Navigate to **Content Calendar** from the dashboard or go to `/calendar`.

### Calendar Overview

Visual week view showing:
- Scheduled drafts by day
- Empty slots for planning
- Drag-and-drop interface

### Ready to Schedule Sidebar

On the right, see all **Approved** drafts ready for scheduling:
- Only approved drafts appear here
- Shows title and content type
- Drag to calendar to schedule

### Scheduling Content

**Method 1: Drag and Drop**
1. Find draft in "Ready to Schedule" sidebar
2. Drag to desired day
3. Release to schedule

**Method 2: From Draft Detail**
1. Open approved draft
2. Click **Schedule**
3. Select date

### Managing Scheduled Content

**Rescheduling:**
- Drag scheduled item to a different day

**Removing from Schedule:**
- Hover over scheduled item
- Click delete icon
- Draft returns to "Ready to Schedule"

---

## Settings Configuration

[LOOM VIDEO PLACEHOLDER - Configuring Settings]

Navigate to **Settings** from the dashboard or go to `/settings`.

### Business Information

Affects how AI writes your content:

| Field | Purpose |
|-------|---------|
| Business Name | Used in content context |
| Business Description | Tells AI what you do |
| Target Audience | Who you're writing for |
| Brand Voice | Tone and style guidelines |

**Tip:** The more detail here, the better your AI-generated content.

### Writing Style & Voice Training

Train the AI to match your writing style:

1. Click **Add Writing Example**
2. Paste a sample of your writing (100+ words recommended)
3. Add up to 4 examples
4. AI analyzes patterns and mimics your style

### Content Type Templates

Customize how each content type is structured:

| Template | Default Length | Editable |
|----------|---------------|----------|
| LinkedIn Post | 1300-1500 chars | ✅ |
| Blog Post | 1200-2000 words | ✅ |
| Case Study | 1500-2500 words | ✅ |

**Editing Templates:**
1. Click on a template
2. Modify the prompt instructions
3. Save changes
4. All future content uses updated template

### AI Provider Configuration

Choose your AI backend:

| Provider | Setup |
|----------|-------|
| Lovable AI | Default, no setup needed (development only) |
| Google AI | Enter your API key from aistudio.google.com |
| Custom | Enter endpoint URL, model name, API key |

**For Production:** Configure Google AI or Custom provider with your own API key.

### Newsletter Email Configuration

**Prerequisites:** Mailgun must be configured by IT team first.

1. Enter your newsletter domain (e.g., `newsletters.yourbusiness.com`)
2. Save
3. Go to Sources → Newsletter Inbox to see your unique email

### Appearance

Customize the look:
- **Dark Mode** - Toggle light/dark theme
- **Primary Color** - Main accent color
- **Secondary Color** - Supporting color
- **Accent Color** - Highlight color

---

## Troubleshooting

[LOOM VIDEO PLACEHOLDER - Common Issues]

### Newsletter Not Appearing

**Check these in order:**

1. **Domain configured?** Settings → Newsletter Email Configuration
2. **Mailgun working?** Ask IT to verify webhook is receiving
3. **Rate limited?** Max 50 emails/hour
4. **Check Sources page** → Newsletter Inbox tab for errors

### AI Processing Fails

1. **Check AI provider** in Settings
2. **Verify API key** is correct and has credits
3. **Try again** - temporary service issues happen
4. **Check content** - very short content may fail

### Content Generation Issues

1. **Add more context** in Business Information
2. **Add writing examples** to improve style matching
3. **Check reference cards** - ensure they have content
4. **Verify content template** isn't empty

### Login Issues

1. **Check email verification** - click link in welcome email
2. **Reset password** - use "Forgot Password"
3. **Clear browser cache** and try again

### Need More Help?

Contact: [SUPPORT EMAIL]
Include:
- What you were trying to do
- What happened instead
- Screenshots if possible

---

## Quick Reference

### Your Information

| Item | Value |
|------|-------|
| App URL | [YOUR APP URL] |
| Newsletter Email | `[auto-generated]@[your-domain]` |
| Login Email | [YOUR LOGIN EMAIL] |

### Key URLs

| Page | Path |
|------|------|
| Dashboard | `/dashboard` |
| Sources | `/sources` |
| Reference Cards | `/cards` |
| Create Content | `/create` |
| Drafts | `/drafts` |
| Calendar | `/calendar` |
| Autopilot | `/autopilot` |
| Review Queue | `/review` |
| Question Settings | `/questions` |
| Observation Journal | `/insights` |
| Settings | `/settings` |

### Keyboard Shortcuts

Currently none - all actions are click-based.

### Content Type Quick Guide

| Type | Best For | Length |
|------|----------|--------|
| LinkedIn | Quick takes, professional updates | 1300-1500 chars |
| Blog Post | Deep dives, SEO content | 1200-2000 words |
| Case Study | Success stories, detailed analysis | 1500-2500 words |

### Status Colors

| Color | Meaning |
|-------|---------|
| 🟢 Green | Approved / Active |
| 🟡 Yellow | Pending |
| 🔴 Red | Rejected |
| ⚫ Gray | Archived |

---

**Questions?** Reach out to [SUPPORT EMAIL]. We're here to help you create great content!
