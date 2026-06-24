import { supabase } from './supabase';

export const OG_STATUS = {
  warm:         { label: 'Warm',         color: '#f59e0b', bg: '#fffbeb' },
  meeting_set:  { label: 'Meeting Set',  color: '#10b981', bg: '#ecfdf5' },
  following_up: { label: 'Following Up', color: '#6366f1', bg: '#eef2ff' },
  cold:         { label: 'Cold',         color: '#94a3b8', bg: '#f8fafc' },
  passed:       { label: 'Passed',       color: '#94a3b8', bg: '#f8fafc' },
};

// Fetch all active Old Gold contacts + their meetings + open tasks for a company.
export async function fetchOldGoldForCompany(companyName) {
  if (!companyName?.trim()) return [];
  const { data: prospects } = await supabase
    .from('old_gold_prospects')
    .select('id, name, status, company, archived_at')
    .ilike('company', companyName.trim())
    .is('archived_at', null);
  if (!prospects?.length) return [];
  const ids = prospects.map(p => p.id);
  const [{ data: meetings }, { data: tasks }] = await Promise.all([
    supabase.from('old_gold_meetings')
      .select('id, prospect_id, title, meeting_date, summary')
      .in('prospect_id', ids)
      .order('meeting_date', { ascending: false }),
    supabase.from('old_gold_tasks')
      .select('id, prospect_id, title, completed, due_date')
      .in('prospect_id', ids)
      .eq('completed', false),
  ]);
  const meetingsByProspect = {};
  (meetings || []).forEach(m => {
    if (!meetingsByProspect[m.prospect_id]) meetingsByProspect[m.prospect_id] = [];
    meetingsByProspect[m.prospect_id].push(m);
  });
  const tasksByProspect = {};
  (tasks || []).forEach(t => {
    if (!tasksByProspect[t.prospect_id]) tasksByProspect[t.prospect_id] = [];
    tasksByProspect[t.prospect_id].push(t);
  });
  return prospects.map(p => ({
    ...p,
    meetings: meetingsByProspect[p.id] || [],
    openTasks: tasksByProspect[p.id] || [],
  }));
}
