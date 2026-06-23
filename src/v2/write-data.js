/* ============================================
   V2 WRITE-DATA LAYER

   Mutations are intentionally separated from
   safe-data.js so the read-only guarantee for
   any component that doesn't import from this
   file is preserved by construction.

   To add a new mutation surface:
     1. Add the export here (visible decision)
     2. Import it from a v2 component
     3. Wire it up

   Anything missing from this file cannot be
   imported by v2 components without bypassing
   the convention — which would surface in code
   review.

   Scope (current):
     • Projects:   create / edit / archive / restore
     • Milestones: create / edit / archive / restore
     • Project tasks:  create / edit / toggle / delete / restore
     • Deals:      create / edit / move stage / delete
============================================ */

export {
    // Projects
    upsertProject,
    archiveProject,
    restoreProject,
    deleteProject,
    // Milestones
    upsertMilestone,
    archiveMilestone,
    restoreMilestone,
    deleteMilestone,
    // Project tasks
    upsertProjectTask,
    toggleTask,
    deleteProjectTask,
    restoreProjectTask,
} from '../lib/projects.js';

export {
    // Deals
    upsertDeal,
    moveStage as moveDealStage,
    deleteDeal,
    // Deal activities
    addActivity,
    deleteActivity,
} from '../lib/deals.js';

export {
    // Support cases
    upsertCase,
    deleteCase,
    addMessage as addCaseMessage,
    deleteMessage as deleteCaseMessage,
} from '../lib/support.js';

export {
    // Settings — only the ICP profile for now
    saveIcp,
} from '../lib/settings.js';
