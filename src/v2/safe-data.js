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
    fetchAllTasksByOwner,
    fetchProjectFiles,
    fetchProjectMeetings,
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
    ACTIVITY_TYPES,
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
    getSlaHours,
    slaSummary,
    fetchCases,
    fetchMessages as fetchCaseMessages,
} from '../lib/support.js';

// ── Settings ─────────────────────────────────────────────
export {
    DEFAULT_ICP,
    loadIcp,
    isWeeklyScanDue,
    loadLastWeeklyScan,
    loadTeamMembers,
    DEFAULT_TEAM_MEMBERS,
} from '../lib/settings.js';

// ── Clients ──────────────────────────────────────────────
// The canonical client store with rich contacts (name, title, email,
// linkedin, source). v2 reads but doesn't write — edits go through Mike's
// legacy Clients page.
export {
    fetchClients,
    fetchClientDetail,
    fetchCompanyIntel,
} from '../lib/clients.js';

// ── Companies (Signal Watch) ─────────────────────────────
import { supabase } from '../lib/supabase.js';

const ANDOVER = { lat: 42.6583, lng: -71.1373 };

/** Haversine distance in miles */
export function distanceMiles(lat, lng) {
    if (lat == null || lng == null) return null;
    const R = 3958.8;
    const dLat = ((lat - ANDOVER.lat) * Math.PI) / 180;
    const dLng = ((lng - ANDOVER.lng) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((ANDOVER.lat * Math.PI) / 180) *
            Math.cos((lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Read-only fetch of companies, ordered by icp_score desc. */
export async function fetchCompanies({ limit = 300 } = {}) {
    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('icp_score', { ascending: false, nullsFirst: false })
        .order('scan_date',  { ascending: false, nullsFirst: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
}

/** Read-only fetch of pipeline entries — returns Set of company ids. */
export async function fetchPipelineCompanyIds() {
    const { data, error } = await supabase
        .from('pipeline_entries')
        .select('company_id');
    if (error) throw new Error(error.message);
    return new Set((data || []).map((r) => r.company_id));
}

/** Trigger category metadata — colors come from v2 tokens, not raw hex. */
export const TRIGGER_CATEGORIES = {
    leadership: { label: 'Leadership',  accent: 'var(--v2-orange)' },
    funding:    { label: 'Funding',     accent: 'var(--v2-teal)' },
    expansion:  { label: 'Expansion',   accent: 'var(--v2-blue)' },
    product:    { label: 'Product',     accent: 'var(--v2-purple)' },
    pain:       { label: 'Pain point',  accent: '#c2451a' },
    hiring:     { label: 'Hiring',      accent: '#1e90ad' },
    social:     { label: 'Social',      accent: '#cc3366' },
};

export const URGENCY_META = {
    high:   { label: 'High',   color: '#c2451a' },
    medium: { label: 'Medium', color: '#c08850' },
    low:    { label: 'Low',    color: 'var(--crm-text-3)' },
};
