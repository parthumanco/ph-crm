# V2 Porting Status

Single source of truth for "what's redesigned vs. what's still legacy" inside
the v2 instance at https://ph-crm-v2.netlify.app.

> Both apps are wired through `src/main.jsx`:
> - `/portal/:token` → ClientPortalPage (Mike's portal)
> - `/legacy` → legacy `App` (fallback / comparison only)
> - everything else → `V2App` (renders V2 pages where ported, legacy pages
>   inside the V2 shell otherwise)

## Pages

| Sidebar item | V2 component | Legacy fallback | Status | Notes |
|---|---|---|---|---|
| Projects | `V2ProjectsPage` | — | ✅ V2 | Full CRUD via `write-data.js` |
| Project detail | `V2ProjectPage` | — | ✅ V2 | Hero + Gantt + milestones with inline tasks + files |
| Deals | `V2DealsPage` | — | ✅ V2 | Drag-drop kanban + Won-creates-project |
| Accounts | `V2AccountsPage` | — | ✅ V2 | Derived from projects+deals+cases (no accounts table) |
| Account hub | `V2AccountPage` | — | ✅ V2 | + New deal, + Log activity, edit deal cards |
| Support | `V2SupportPage` | — | ✅ V2 | Reply / internal note / status change / resolve / create / edit / delete |
| Signals | `V2SignalsPage` | — | ✅ V2 | **Read-only** — scan/CSV/pipeline-add not yet wired |
| ICP Settings | `V2SettingsPage` | — | ✅ V2 | ICP fields only — brand brain / team / weekly-scan config still on legacy |
| Discover | — | `DiscoverPage` | 🟡 Legacy | Fully functional via shim |
| Outreach (Active Pipeline) | — | `PipelinePage` | 🟡 Legacy | Fully functional via shim |
| Old Gold | — | `OldGoldPage` | 🟡 Legacy | New page Mike added — passes `isActive` + `onNavigate` |
| Clients | — | `ClientsPage` | 🟡 Legacy | New page Mike added — passes `icp` + `onNavigate` |
| Documents | — | `DocumentsPage` | 🟡 Legacy | New page Mike added |
| Weekly Report | — | `WeeklyReportPage` | 🟡 Legacy | |
| Little Stevie | — | `ChatPage` | 🟡 Legacy | |

**Status legend:**
- ✅ V2 — designed and functional in V2
- 🟡 Legacy — Mike's legacy page rendered inside V2 shell via `LegacyShim`
- 🚧 Partial — V2 exists but missing mutations or features
- ❌ Not in V2 — page exists in legacy but no V2 entry yet

**Mutations still missing on ported pages:**
- Signals: add to pipeline, run deep scan, weekly rescan, CSV import, edit/delete company
- ICP Settings: extend to cover brand brain, team members, weekly-scan config

## Known feature-parity gaps (from the V2-vs-legacy audit)

Tracked here so they're visible, not silent. Fix in priority order
(top items are real "where did my data go?" risks).

### Account hub — `V2AccountPage`
- **Documents tab** — legacy `ClientsPage` Documents tab surfaces
  client-level documents + files. V2 has no surface yet.
- **Ask AI tab** — legacy `ClientsPage` Ask AI chat. V2 has no surface yet.
- **Quick Scan / Deep Scan / Build Thesis / Export PDF buttons** —
  mutation-class. Open in legacy for now.
- **Add/edit/delete client record itself** (notes editable in place,
  website/linkedin_url editing) — mutation-class. Open in legacy.
- **Restore archived project from the account view** — workflow gap.

### Deals — `V2DealsPage`
- **Drag-to-Won data migration** — legacy moves meetings/tasks/files
  onto the new project. V2's `moveDealStage('won')` only creates
  the project shell. ⚠ Real data loss risk on Won.
- **Lost-deals browse panel** with `lost_reason`. V2 has count only.
- **Split retainer/month + project-value chips** on deal cards. V2
  collapses to one figure.
- **Log Meeting / TranscriptImporter** button on the page.
- **Draft Proposal → auto-create project with milestones from
  parsed proposal** (lives in legacy DealDetailModal).

### Projects list — `V2ProjectsPage`
- **Team Tasks ("Assigned") view** — per-owner task triage with
  rejected/active/completed groups. No V2 entry point. ⚠ Daily-use
  workflow gone.
- **Archived projects collapsible** with Restore / hard-delete.
- **File-count badge**, **contact_name**, **end_date** on the row.
- Dead `review` status filter (no matching data).

### Accounts list — `V2AccountsPage`
- **Semantic divergence** — V2 derives accounts from any
  deal/project/case `company_name`; legacy lists rows from the
  `clients` table. A company with only a deal appears in V2 but
  not legacy; a client with nothing active appears in legacy but
  not V2. Worth documenting in the UI.
- **+ New account / inline create** affordance.

### Support — `V2SupportPage`
- **`assigned_to` (owner)** — missing from case row, thread header,
  filter, AND composer hard-codes `author_name: 'Peter'`. ⚠ Multi-
  person team data loss.
- **Channel icon + label** on the case row (email/chat/etc.).
- **Owner filter dropdown** on the list.
- **Priority filter dropdown** on the list.
- **Status segmented tabs** on the list.
- **Search box** on the list (title/company/contact).
- **SLA on-time % stat** instead of meaningless "Priorities count".
- **Case age column** (Today / 1d ago / Nd ago).
- Likely double-count in stat — V2 counts `awaiting_reply || open`.

### Signals — `V2SignalsPage`
- **Sort control** (icp / signal score / name).
- **Signal score / overall_score** display on the row (only shown
  as a filter slider currently).
- **Scan date** display per row.
- **CSV export** (read-only, separate from CSV import).

### ICP Settings — `V2SettingsPage`
- No ICP-field gaps. Field labels differ between V2 and legacy
  but keys match — same data, different language.

## Parallel work — rules of the road

### Ownership boundaries

| Path | Owner | Other side touches it? |
|---|---|---|
| `src/lib/*` | Mike (legacy) | V2 only reads via `safe-data.js` |
| `src/pages/*` | Mike | Never. V2 renders via legacy fallback. |
| `src/components/*` | Mike | Never. |
| `src/App.jsx` | Mike | Never. |
| `src/index.css` | Mike | Never. V2 scopes all CSS under `.v2-app`. |
| `src/v2/*` | V2 team | Mike never touches. |
| `src/main.jsx` | **Boundary** | Coordinate before changing. |

### Cadence

- Mike pushes to `main` whenever — production at `ph-crm.netlify.app` rebuilds.
- V2 team pushes to `ux/redesign-v2` whenever — v2 at `ph-crm-v2.netlify.app` rebuilds.
- Whoever is on the v2 branch runs `git merge main` once a day (or whenever
  Mike ships something substantial). This pulls his work through to the v2
  instance with effectively no conflict risk because of the boundaries above.

### How to port a legacy page to V2

1. Build `V2<Name>Page.jsx` in `src/v2/` using:
   - Reads through `safe-data.js`
   - Writes through `write-data.js` (extend if needed — keep mutations
     explicit and visible)
   - Editorial section pattern + tokens from `v2.css`
2. Import it in `V2App.jsx`, add to the `PORTED` set, remove the legacy
   fallback line for that page.
3. Update this file's table — flip 🟡 → ✅ for that page.
4. PR / push to `ux/redesign-v2`.

## Architecture notes

- **Read-only is a convention, not a constraint.** `safe-data.js` re-exports
  read functions; `write-data.js` re-exports the writes V2 explicitly opted
  into. To add a new mutation, extend `write-data.js` — it's the single
  visible decision point.
- **No URL routing yet.** Navigation is in-memory state on `V2App`'s `view`.
  Once the port is largely complete, we'll add `react-router-dom` so
  deep links work.
- **V2 styles never leak.** All v2 CSS is scoped to `.v2-app` (and the shim
  to `.v2-legacy-shim`). The legacy app inside `/legacy` renders bit-for-bit
  identical to production at `ph-crm.netlify.app`.
