# Part Human CRM — Setup Guide
### For Mike and Pete

---

## What You're Setting Up

A private sales intelligence tool that:
- Scans prospect companies for trigger events (Signal Watch)
- Tracks your 5-touch outreach cadence (Pipeline)
- Generates personalized email drafts automatically
- Produces a weekly outreach plan every Sunday
- Has an AI assistant you can talk to about your pipeline

Both of you will share the same live database (Supabase), so changes either of you make appear for both.

---

## Step 1 — Set Up Your Shared Database (Supabase)

This is a one-time setup. One of you does this, then shares the credentials with the other.

**1a. Create a Supabase account**
- Go to **supabase.com**
- Click **Start your project** and sign up with a Google or GitHub account (free)

**1b. Create a new project**
- Click **New Project**
- Name it: `part-human-crm`
- Set a database password (save it somewhere — you won't need it often)
- Choose any region (US East is fine)
- Click **Create new project** and wait ~2 minutes for it to finish

**1c. Run the database schema**
- In your Supabase project, click **SQL Editor** in the left sidebar
- Click **New query**
- Open the file `ph-crm/supabase_schema.sql` from your computer (you can open it in TextEdit or any text editor)
- Copy the entire contents and paste it into the SQL Editor
- Click **Run** (the green button)
- You should see "Success. No rows returned."

**1d. Get your credentials**
- In the left sidebar, click **Project Settings** (gear icon at the bottom)
- Click **Data API** (or **API**)
- Copy two things:
  - **Project URL** (looks like `https://abcdefgh.supabase.co`)
  - **anon public** key (a long string starting with `eyJ...`)

---

## Step 2 — Set Up the App on Your Computer

Open your Terminal app. (Search "Terminal" in Spotlight — Cmd+Space, type Terminal, press Enter.)

**2a. Navigate to the app folder**

```
cd ~/ph-crm
```

**2b. Create your credentials file**

In Terminal, run this command exactly:

```
cp .env.example .env
```

Then open the `.env` file. In Finder, press Cmd+Shift+G, paste `~/ph-crm`, press Enter, and double-click the `.env` file. It will open in TextEdit.

You'll see:
```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_ANTHROPIC_API_KEY=your_anthropic_api_key
```

Replace the three placeholder values with:
- `VITE_SUPABASE_URL` → your Supabase Project URL from Step 1d
- `VITE_SUPABASE_ANON_KEY` → your Supabase anon public key from Step 1d
- `VITE_ANTHROPIC_API_KEY` → your Anthropic API key (same one used in SignalWatch)

Save and close the file.

**2c. Start the app**

In Terminal, run:

```
cd ~/ph-crm && npm run start
```

*(First time only: if it asks to load nvm, close Terminal, reopen it, and try again.)*

Your browser will open automatically at **http://localhost:5173**

---

## Step 3 — Pete's Setup (run on Pete's computer)

Pete needs to do Steps 2a and 2b on his machine. Skip Step 1 entirely — he uses the same Supabase database.

Mike: share the `.env` file contents with Pete securely (AirDrop the file, or share via iMessage). **Do not email it.**

---

## How to Start the App Each Day

Open Terminal and run:
```
cd ~/ph-crm && npm run start
```

Or, if you want it to open without typing:
1. Open **Automator** (search it in Spotlight)
2. Create a new **Application**
3. Add a **Run Shell Script** action
4. Paste: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; cd ~/ph-crm && npm run dev -- --open`
5. Save to Desktop as "Part Human CRM"

---

## How to Use the App

### Signal Watch Tab (📡)
1. Prepare a CSV of companies you want to scan. Minimum columns needed: `name`, `website` (optional but helpful), `contact`, `title`, `email`
2. Drag and drop the CSV onto the drop zone (or click to browse)
3. Click **⚡ Scan All** to run a fast batch scan using your ICP profile
4. For any company, click **🔍 Deep Scan** to run a real-time web search for the latest news
5. When a company scores well, click **+ Add to Pipeline** — it appears in your Pipeline tab instantly

### Pipeline Tab (🎯)
- See every active prospect and where they are in the 5-touch cadence
- **Touch pills** (the circles 1–5) show the status: blue = ready, green = sent, purple = responded
- **Draft T1** / **Draft T2** buttons open the email generator for that touch
- **Log Reply** — paste in a prospect's email and get AI analysis + suggested reply
- **Notes** — add any context you want to remember

### Weekly Report Tab (📋)
**Every Sunday night or Monday morning:**
1. Click **🚀 Generate This Week's Plan** — get an AI briefing on your pipeline
2. Click **✉️ Draft All Emails** — generates every email draft for the week automatically
3. Click any company row to expand and see the full draft
4. Click **📋 Copy** to copy it, then paste directly into Gmail
5. After sending in Gmail, come back and click **Mark as Sent** in the Pipeline tab

### AI Assistant Tab (💬)
- Ask anything: "Who should I prioritize?", "What should I say to Yoodli?", "How many touches are overdue?"
- Use the quick-prompt chips for common questions
- The AI has full visibility into your live pipeline

---

## Your Weekly Rhythm

| Day | Action |
|-----|--------|
| **Monday** | Open Weekly Report → Generate plan → Draft all emails → Review and edit |
| **Thursday** | Send the 3–5 emails in Gmail → Return to Pipeline → Mark as Sent |
| **Friday** | Log any replies (Log Reply button) → Check pipeline status → Set priorities for next week |
| **Sunday night** | Run Weekly Report for next week |

---

## CSV Format for Signal Watch

The easiest format — save a spreadsheet as CSV with these column names:

```
name, website, contact, title, email, linkedin, hq
```

Example:
```
name,website,contact,title,email,linkedin,hq
Yoodli,https://yoodli.ai,Varun Puri,CEO,varun@yoodli.ai,,Seattle WA
Sorcero,https://sorcero.com,Dipanwita Das,CEO,,,Washington DC
```

Any column order works. Extra columns are ignored.

---

## If Something Breaks

**"Cannot connect to Supabase"** → Check your `.env` file. Make sure there are no spaces around the `=` sign and the values are on one line.

**"API Error 401"** → Your Anthropic API key is wrong. Double-check the key in `.env`.

**"Rate limited"** → You hit Anthropic's API limit. Wait 60 seconds and try again.

**App won't open** → In Terminal, run `cd ~/ph-crm && npm run dev` and look at the error message. Copy it and share with your developer.

---

## What's Coming Next

Future additions we can build on top of this:
- Auto-send the weekly report to you by email every Sunday night
- Gmail integration (send directly from the app, no copy/paste)
- A hosted version at a URL so there's nothing to run locally
- Automated prospect discovery (finds new Series A/B companies automatically)

---

*Built for Part Human by Claude Code — May 2026*
