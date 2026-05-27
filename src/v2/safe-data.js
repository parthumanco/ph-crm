/* ============================================
   V2 READ-ONLY DATA LAYER

   All v2 components import data functions through
   this file, NOT directly from lib/*.js. Only
   read/fetch functions and pure helpers are
   re-exported here.

   This is the defense-in-depth for the "v2 is
   read-only" guarantee: even if a future
   component accidentally tries to call a
   mutation, it can't import one through this
   path. To add a mutation later, it must be
   explicitly added here — making the decision
   visible.

   If the v2 instance ever needs to write data,
   that will be an intentional schema-level
   change (RLS policies + a dedicated v2 anon
   key), not a quiet import.
============================================ */

// ── Projects ─────────────────────────────────────────────
export {
    fetchProjects,
    fetchArchivedProjects,
    fetchMilestones,
    fetchArchivedMilestones,
    fetchProjectTasks,
    fetchProjectFiles,
    PROJECT_STATUSES,
    MILESTONE_STATUSES,
    projColor,
    projLabel,
    msColor,
    msLabel,
    daysBetween,
    addDays,
    projectProgress,
    fmtDate,
} from '../lib/projects.js';

// ── Deals ────────────────────────────────────────────────
export {
    STAGES as DEAL_STAGES,
    ACTIVE_STAGES as DEAL_ACTIVE_STAGES,
    CLOSED_STAGES as DEAL_CLOSED_STAGES,
    OWNERS as DEAL_OWNERS,
    stageColor,
    stageLabel,
    dealValue,
    fmt$,
    daysSince,
    fetchDeals,
    fetchActivities,
    fetchTasks as fetchDealTasks,
} from '../lib/deals.js';

// ── Support ──────────────────────────────────────────────
export {
    CASE_STATUSES,
    CASE_PRIORITIES,
    CHANNELS,
    statusColor   as caseStatusColor,
    statusLabel   as caseStatusLabel,
    priorityColor as casePriorityColor,
    priorityLabel as casePriorityLabel,
    channelIcon,
    channelLabel,
    fetchCases,
    fetchMessages as fetchCaseMessages,
} from '../lib/support.js';
