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
