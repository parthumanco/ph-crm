/* ============================================
   V2 READ-ONLY DATA LAYER

   All v2 components import data functions through
   this file, NOT directly from lib/projects.js,
   lib/deals.js, etc. Only read/fetch functions
   are re-exported here.

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

export {
    // Projects — read only
    fetchProjects,
    fetchArchivedProjects,
    fetchMilestones,
    fetchArchivedMilestones,
    fetchProjectTasks,
    fetchProjectFiles,
    // Helpers (pure, no DB calls)
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
