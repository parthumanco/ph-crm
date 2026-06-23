# ph-crm — Application Logic Reference

A complete reference for how this app works: every page's purpose, the data model, and the
cross-cutting business logic that ties pages together. Intended as the canonical doc to
re-orient against when picking this codebase back up.

ph-crm is a sales/project management CRM for **Part Human**, a brand strategy agency. The
core lifecycle is:

```
Signal Watch (scan prospects) → Pipeline (5-touch outreach) → Deals (sales Kanban)
  → Won deal auto-creates a Project (milestones/tasks/client portal)
```

AI research (Quick Scan → Deep Scan → Build Thesis) enriches company intelligence at every
stage to recommend engagement tier and talking points.

---

## 1. Pages

| Page | Purpose |
|---|---|
| **DealsPage** | Sales pipeline as a drag-and-drop Kanban (`prospect → outreach → responded → discovery_call → proposal_sent → negotiation → won/lost/nurture`). Dragging a deal to **Won** auto-creates a project and migrates its meetings/tasks/files. Dragging to **Lost** animates into a trash bin. Deal value = `(retainer_value × 12) + project_value`. |
| **ClientsPage** | Hub for client companies. Tabs: Overview, Intelligence (AI-scored company data), Projects, Deals, Activities, Meetings, Documents, Files, Ask AI. Runs Quick Scan / Build Thesis. Contact dossiers can be individually AI-enriched. New clients/projects can be created directly here. |
| **ProjectsPage** (largest page, ~6k lines) | Full project management: milestones → tasks → files/meetings, drag-and-drop task moves between milestones, file archive/restore, proposal-to-timeline AI import, client-portal sharing via `share_token`, task approval/rejection review chain. |
| **SignalWatchPage** ("Watch List") | Prospect scanning system. CSV import or manual add → Quick Scan (batch ICP scoring) → optional Deep Scan (web+LinkedIn research) → weekly auto-rescan → "Add to Prospects" promotes a company into the pipeline. Heavy filtering (series, employees, distance, ICP/signal score, industry, scan date, etc.). |
| **PipelinePage** ("Active Outreach" / "Prospects") | Lighter-weight outreach tracker, separate from `deals`. Each `pipeline_entries` row runs a 5-touch cadence (email → follow-up → LinkedIn → goodwill → close). Status change to "won" auto-creates a deal. |
| **OldGoldPage** ("Old Gold") | Pete's hand-picked warm-outreach contacts, independent of the companies/clients model. Has a quick-drop flow: paste/drop a transcript, AI extracts contact + company + cross-references existing deals, auto-saves. Soft-delete (archive/restore). |
| **ClientPortalPage** | Token-gated, read-only-ish client-facing view of one project (`share_token`). Clients can reject tasks (with notes), reply to PM revisions, approve milestones. |
| **DocumentsPage** | Generates Proposal / Goals & Objectives / SOW / MSA / Mutual NDA documents via AI, using full company context. WYSIWYG editor, draft/sent/signed status. |
| **DiscoverPage** | Lightweight ad-hoc research tool (paste a name/URL, quick AI lookup) — a pre-Signal-Watch scratchpad. |
| **WeeklyReportPage** | Rolls up pipeline health: touches due, engagement-tier recommendations, win rate, activity summary, upcoming closes — generates a weekly summary. |
| **ChatPage** ("Little Stevie") | Conversational AI over the whole pipeline (entries, companies, touches) for ad-hoc questions. |
| **SettingsPage** | Brand Brain editor (voice/tone/services — feeds every AI prompt), ICP editor (scoring rubric), team member rates, API keys. |
| **SupportPage** | Internal support-ticket tracker (`cases` + `case_messages`), SLA timers by priority. |

---

## 2. Data model (Supabase tables)

Soft-delete convention used throughout: an `archived_at` (or `deleted_at`) timestamp column;
`null` = active, set = archived. Hard delete is rare and reserved for genuinely disposable
records (activities, touches, etc).

| Table | Stores | Soft-delete? | Key relationships |
|---|---|---|---|
| `deals` | Sales pipeline deals | No (stage-based) | — |
| `activities` | Deal-level log (calls/emails/notes) | No | `deal_id` |
| `tasks` | Deal-level follow-ups | No | `deal_id` |
| `deal_files` / `deal_task_files` | Deal/task attachments | No | `deal_id` / `task_id` |
| `clients` | Partner-firm Rolodex (name, website, **contacts** JSON) | No | matched to `companies` **by name**, not FK |
| `companies` | AI-researched intel (ICP/signal scores, triggers, contact_angles, thesis) | No | matched to `clients`/`projects` **by name** |
| `projects` | Scope-of-work engagements | **Yes** (`archived_at`) | `client_id`, `source_deal_id` |
| `milestones` | Project phases | **Yes** (`archived_at`) | `project_id` |
| `project_tasks` | Deliverables within a milestone | **Yes** (`deleted_at`) | `project_id`, `milestone_id` |
| `project_files` | Project/milestone/task attachments + external links | **Yes** (`archived_at`) | `project_id`/`milestone_id`/`task_id` |
| `project_meetings` | Meeting logs (also used pre-win, keyed by `deal_id`) | No | `project_id` or `deal_id` |
| `pipeline_entries` | Outreach-pipeline company tracking | No | `company_id` |
| `touches` | 5-touch outreach cadence | No | `pipeline_entry_id` |
| `documents` | Generated proposal/SOW/MSA/etc. | No | `deal_id`, `company_id` |
| `company_files` | Saved HTML snapshots of generated docs | No | `company_name` |
| `client_items` | Client research notes/links | No | `client_id` |
| `cases` / `case_messages` | Support tickets | No | `case_id` |
| `app_settings` | Key-value config (Brand Brain, ICP, team, scan tracking) | n/a (upsert) | — |
| `old_gold_prospects` | Pete's warm contacts | **Yes** (`archived_at`) | — |
| `old_gold_meetings` / `old_gold_tasks` | Meetings/tasks for Old Gold prospects | No | `prospect_id` |

**The one architectural fragility worth remembering:** `clients` and `companies` are two
separate tables linked only by case-insensitive name match (`ilike`), never a foreign key.
A typo or rename in either table silently orphans AI intelligence from the client record —
this has caused real bugs (e.g. "Dennison" vs "Denison" Yacht Sales). `fetchClients()` runs
an orphan-reconciliation pass on load as a partial safety valve, but the underlying fragility
remains. A proper fix would store a real `company_id` FK.

---

## 3. Core cross-cutting flows

### Deal → Won → Client/Project creation

1. Deal dragged to **Won** → `moveStage(dealId, 'won')` sets `stage`, `won_date`, `stage_entered_at` (`deals.js`).
2. `createProjectFromDeal(deal)` fires (DealsPage):
   - `upsertProject({ name: company_name, client_name: company_name, source_deal_id })` — this internally calls `findOrCreateClient()` to link/create the `clients` row.
   - `upsertClientContacts(clientId, [dealContact])` syncs the deal's contact onto the client.
   - `migrateDealMeetingsToProject(dealId, projId)` — **re-points** `project_meetings.deal_id → project_id` (live move, not a copy).
   - `migrateDealTasksToProject(dealId, projId)` — **copies** deal tasks into `project_tasks`, remapping task IDs, and copies `deal_task_files → project_files`.
   - `migrateDealFilesToProject(dealId, projId)` — **copies** `deal_files → project_files`.
3. Alternative path: importing a proposal PDF (`parseProposalWithAI` → `buildTimelineFromParsed`) generates the milestone/task structure instead of starting empty; same migration steps still run.

### AI research ladder: Quick Scan → Deep Scan → Build Thesis → silent refresh

| Action | Where | Model | What it does |
|---|---|---|---|
| **Quick Scan** | SignalWatchPage | Haiku | Batch ICP/signal scoring, no web search. Fast, cheap, for triage. |
| **Deep Scan** | SignalWatchPage, ClientsPage, DealDetailModal | Opus | Per-company web + LinkedIn research: triggers, contacts, scores. Writes `companies.deep_scanned=true`, `scan_date`. |
| **Build Thesis** | ClientsPage, DealDetailModal | Opus | Synthesizes *everything* (intel + projects + deals + meetings + activities + notes) into a strategic narrative, risks, and a recommended next step. Sets `thesis_built=true`. |
| **silentRefreshThesis** | Auto-triggered after adding a file/note/meeting/contact (ClientsPage, ProjectsPage) | Opus (via Build Thesis) | Background, non-blocking re-run of Build Thesis — **only if a thesis already exists** (`intel?.id` gate). Never auto-builds one from scratch. Keeps the thesis current without a manual click. |

Merge semantics matter here: `mergeTriggers()` dedupes by headline (incoming wins on
overlap); `mergeContactAngles()` preserves manually-entered enrichment (email, LinkedIn,
notes) if a fresh scan doesn't rediscover it — scans are additive, not destructive.

### Watch List → Pipeline → Deal pipeline

```
CSV/manual add → Quick Scan → [optional Deep Scan] → weekly auto-rescan loop
  → "Add to Prospects" → pipeline_entries row (status='active') + 5 touches seeded
  → touch cadence (7-day spacing) → status→'won' auto-creates a deal
```

### Archive/restore (soft-delete)

Consistent `fetch()` / `fetchArchived()` / `archiveX()` / `restoreX()` function-pairs exist
independently for: `projects`, `milestones`, `project_files`, and `old_gold_prospects`
(4 near-identical copies of the same pattern — no shared helper). `project_tasks` is the
odd one out, using `deleted_at` instead of `archived_at`.

### Client portal

Each project can carry a `share_token`. `ClientPortalPage` resolves a project by token
(read access only via that token, no login). Clients can reject a task with notes; the PM
sees the rejection in `ProjectsPage`, can reply, and clears the rejection to re-open
approval. Full history lives in each task's `review_chain` JSON array.

### Drag-and-drop

- **DealsPage**: native HTML5 DnD moves a deal card between stage columns; Won/Lost stages
  trigger animation sequences before the DB write.
- **ProjectsPage**: tasks can be dragged between milestones (and to/from "Unassigned") —
  `handleMoveTaskToMilestone` does an optimistic update with rollback on failure.

---

## 4. `src/lib/*.js` function inventory

- **`deals.js`** — stage/value constants & helpers; CRUD for deals, activities, tasks, deal files, deal task files.
- **`projects.js`** — project/milestone/task/file CRUD with archive variants; PDF-to-timeline AI parsing; client-portal token lookup + approval/rejection flow; deal→project migration functions; meeting CRUD.
- **`clients.js`** — client & company CRUD; `findOrCreateClient`/`findOrCreateCompany` (the name-matching layer); contact merge helpers; `runClientDeepScan` / `runBuildThesis` / `silentRefreshThesis`; client Q&A.
- **`anthropic.js`** — every Claude API call in the app (`scanBatch`, `scanDeepDive`, `weeklyRescanBatch`, `buildCompanyThesis`, `askClientQuestion`, document generation, pipeline chat, etc.) plus the engagement-tier scoring rules and Brand Brain/ICP prompt builders.
- **`documents.js`** — document CRUD, company picker (merges deals+clients+companies), `gatherCompanyContext()` (the context-builder fed into AI document generation), company-file snapshot storage.
- **`settings.js`** — Brand Brain and ICP load/save, weekly-scan tracking, team member/rate storage.
- **`granola.js`** — Granola meeting-recorder integration: note fetch/match/import, dedupe via stored note IDs.
- **`support.js`** — support case/message CRUD, SLA calculation.
- **`reminders.js`** — localStorage-backed browser notification reminders for due tasks.

---

## Open architectural risks (worth revisiting)

1. **Name-based client↔company linking** — no FK, fragile to typos/renames (see §2).
2. **Soft-delete pattern duplicated 4+ times** with no shared helper — a future convention
   change (e.g. adding `archived_by`) means hunting down every copy by hand.
3. **AI call frequency** — `silentRefreshThesis` fires on essentially every add action
   (file, note, contact, meeting) across two different pages with no debounce, so rapid
   sequential edits can fire several full Opus calls back-to-back.
