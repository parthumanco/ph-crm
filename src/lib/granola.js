/**
 * Granola Integration Layer
 *
 * API docs: https://docs.granola.ai/introduction
 * Base URL:  https://public-api.granola.ai
 * Auth:      Authorization: Bearer grn_YOUR_API_KEY
 *
 * NOTE ON CORS: The Granola API may not support direct browser requests.
 * If you hit CORS errors after wiring up the key, the fix is a one-line
 * Supabase Edge Function proxy — swap GRANOLA_API below to your edge function
 * URL and pass the key as a request header from there instead.
 *
 * Flows supported:
 *   1. Manual sync from the Meetings tab → syncDealMeetings(deal, deals)
 *   2. Full pipeline sync (future) → syncAllDeals(deals)
 *
 * Duplicate prevention: imported Granola note IDs are stored in
 * app_settings (key: "granola_imported_notes") so re-syncing is safe.
 */

import { supabase } from './supabase';
import { saveProjectMeeting } from './projects';

const GRANOLA_API = 'https://public-api.granola.ai';

// ── API key storage ───────────────────────────────────────────────────────────

export async function loadGranolaApiKey() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'granola_api_key')
      .single();
    return data?.value?.key || '';
  } catch {
    return '';
  }
}

export async function saveGranolaApiKey(key) {
  const { error } = await supabase.from('app_settings').upsert(
    { key: 'granola_api_key', value: { key: key.trim() }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

// ── Imported note ID tracking (prevents duplicate imports) ───────────────────

async function loadImportedNoteIds() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'granola_imported_notes')
      .single();
    return new Set(data?.value || []);
  } catch {
    return new Set();
  }
}

async function markNotesImported(noteIds) {
  if (!noteIds.length) return;
  const existing = await loadImportedNoteIds();
  noteIds.forEach(id => existing.add(id));
  await supabase.from('app_settings').upsert(
    { key: 'granola_imported_notes', value: Array.from(existing), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

// ── Granola API calls ─────────────────────────────────────────────────────────

async function granolaFetch(path, apiKey, params = {}) {
  const url = new URL(`${GRANOLA_API}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid Granola API key — check Settings → Integrations');
    if (res.status === 404) throw new Error('Note not found');
    const text = await res.text().catch(() => '');
    throw new Error(`Granola API error ${res.status}${text ? ': ' + text.slice(0, 120) : ''}`);
  }

  return res.json();
}

/**
 * Test that an API key is valid by fetching one note.
 * Returns { ok: true, name } on success or throws on failure.
 */
export async function testGranolaConnection(apiKey) {
  const data = await granolaFetch('/v1/notes', apiKey, { page_size: 1 });
  return { ok: true, count: data.total ?? data.notes?.length ?? 0 };
}

/**
 * Fetch a page of notes, optionally filtered to those created/updated after a date.
 * Returns { notes, next_cursor }
 */
export async function fetchGranolaNotes(apiKey, { updatedAfter, cursor, pageSize = 30 } = {}) {
  const data = await granolaFetch('/v1/notes', apiKey, {
    updated_after: updatedAfter || null,
    cursor:        cursor       || null,
    page_size:     pageSize,
  });
  return {
    notes:       data.notes       || [],
    next_cursor: data.next_cursor || null,
  };
}

/**
 * Fetch a single note including its full transcript.
 */
export async function fetchGranolaNote(apiKey, noteId) {
  return granolaFetch(`/v1/notes/${noteId}`, apiKey, { include: 'transcript' });
}

// ── Matching: Granola note → CRM deal ─────────────────────────────────────────

/**
 * Strip common company suffixes and punctuation to get a bare domain token.
 * "Stone Edge Farm LLC" → "stoneedgefarm"
 */
function companyToDomainToken(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|corp|ltd|co|company|group|holdings|enterprises|solutions|labs|studio|studios|digital|media|tech|technologies|consulting|agency|ventures|capital)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Score how strongly a Granola note matches a given deal.
 * Score >= 30 = match. Higher = more confident.
 */
function scoreNoteForDeal(note, deal) {
  let score = 0;

  // All email addresses in this note (attendees + calendar invitees)
  const attendeeEmails = [
    ...(note.attendees || []).map(a => a.email?.toLowerCase()).filter(Boolean),
    ...(note.calendar_event?.invitees || []).map(i => i.email?.toLowerCase()).filter(Boolean),
    note.calendar_event?.organiser?.toLowerCase(),
  ].filter(Boolean);

  const attendeeNames = (note.attendees || []).map(a => a.name?.toLowerCase().trim()).filter(Boolean);

  // 1. Direct contact email match — near-certain
  if (deal.contact_email) {
    if (attendeeEmails.includes(deal.contact_email.toLowerCase())) {
      score += 100;
    }
  }

  // 2. Email domain match — strong signal
  const token = companyToDomainToken(deal.company_name);
  if (token.length >= 3) {
    const domainMatch = attendeeEmails.some(e => {
      const domain = e.split('@')[1] || '';
      return domain.replace(/[^a-z0-9]/g, '').includes(token);
    });
    if (domainMatch) score += 60;
  }

  // 3. Contact name in attendees
  if (deal.contact_name) {
    const contactLower = deal.contact_name.toLowerCase();
    const nameMatch = attendeeNames.some(n =>
      n.includes(contactLower) || contactLower.includes(n)
    );
    if (nameMatch) score += 40;
  }

  // 4. Company name in meeting title
  const titleText = [
    note.title,
    note.calendar_event?.event_title,
  ].filter(Boolean).join(' ').toLowerCase();

  if (deal.company_name && titleText.includes(deal.company_name.toLowerCase())) {
    score += 30;
  }

  // Exclude Part Human's own team members from matching (their emails = the API owner's)
  // If every attendee is internal, this note is probably an internal meeting
  const ownerEmail = note.owner?.email?.toLowerCase();
  const nonOwnerAttendees = attendeeEmails.filter(e => e !== ownerEmail);
  if (nonOwnerAttendees.length === 0) score = 0; // all-internal meeting

  return score;
}

/**
 * Given a Granola note and a list of all deals, return the best-matching deal
 * (or null if no deal scores >= 30).
 */
export function matchNoteToDeal(note, deals) {
  let best = null;
  let bestScore = 29; // minimum threshold

  for (const deal of deals) {
    const score = scoreNoteForDeal(note, deal);
    if (score > bestScore) {
      bestScore = score;
      best = deal;
    }
  }

  return best;
}

// ── Transcript formatting ─────────────────────────────────────────────────────

/**
 * Convert Granola's transcript array into a readable plain-text string.
 * macOS format:  { speaker: { source: "microphone"|"speaker" }, text }
 * iOS format:    { speaker: { source: "microphone", diarization_label: "Speaker A" }, text }
 */
function formatTranscript(transcript, ownerName = 'Us') {
  if (!transcript?.length) return '';

  return transcript.map(entry => {
    const src = entry.speaker?.source || '';
    const label = entry.speaker?.diarization_label;

    let speaker;
    if (label) {
      // iOS diarization — we don't know which label is which person
      speaker = label;
    } else {
      // macOS: microphone = the person running Granola (Mike/Pete), speaker = far end
      speaker = src === 'microphone' ? ownerName : 'Guest';
    }

    return `${speaker}: ${entry.text}`;
  }).join('\n');
}

// ── Import a single note as a meeting ─────────────────────────────────────────

/**
 * Save a Granola note as a project_meetings record.
 * Fetches the full note (with transcript) then calls saveProjectMeeting.
 */
async function importNote(note, dealId, apiKey) {
  // Fetch full note to get transcript
  let fullNote = note;
  try {
    fullNote = await fetchGranolaNote(apiKey, note.id);
  } catch {
    // If full fetch fails, proceed with what we have (no transcript)
  }

  const ownerName = fullNote.owner?.name || 'Us';
  const transcriptText = formatTranscript(fullNote.transcript, ownerName);

  // Use meeting date from calendar event, fall back to created_at date
  const meetingDate = fullNote.calendar_event?.scheduled_start_time
    ? fullNote.calendar_event.scheduled_start_time.slice(0, 10)
    : fullNote.created_at?.slice(0, 10) || null;

  const title = fullNote.title
    || fullNote.calendar_event?.event_title
    || 'Meeting';

  const summary = fullNote.summary_markdown || fullNote.summary_text || null;

  const meeting = await saveProjectMeeting({
    dealId,
    projectId:   null,
    title,
    meetingDate,
    summary,
    transcript:  transcriptText || null,
    actionItems: [], // Granola doesn't extract action items; use TranscriptImporter for that
  });

  return meeting;
}

// ── Main sync functions ───────────────────────────────────────────────────────

/**
 * Sync Granola meetings for a single deal.
 *
 * Fetches recent Granola notes, matches them to this deal, and saves any
 * that haven't been imported yet.
 *
 * @param {object} deal       — the CRM deal object { id, company_name, contact_name, contact_email }
 * @param {string} apiKey     — Granola API key (load via loadGranolaApiKey())
 * @param {object} options
 *   @param {string} options.updatedAfter  — ISO date string; only fetch notes updated after this
 * @returns {{ imported: meeting[], skipped: number, errors: string[] }}
 */
export async function syncDealMeetings(deal, apiKey, { updatedAfter } = {}) {
  if (!apiKey) throw new Error('No Granola API key configured — add one in Settings → Integrations');

  const imported        = [];
  const importedNoteIds = []; // collected here so we don't rely on saveProjectMeeting returning granola_note_id
  const errors          = [];
  let   skipped         = 0;
  const alreadyImported = await loadImportedNoteIds();

  let cursor = null;
  let pagesFetched = 0;

  // Fetch up to 3 pages (90 notes) to find matches — enough for most use cases
  do {
    const { notes, next_cursor } = await fetchGranolaNotes(apiKey, {
      updatedAfter,
      cursor,
      pageSize: 30,
    });

    for (const note of notes) {
      if (alreadyImported.has(note.id)) { skipped++; continue; }

      const score = scoreNoteForDeal(note, deal);
      if (score < 30) continue;

      try {
        const meeting = await importNote(note, deal.id, apiKey);
        imported.push(meeting);
        importedNoteIds.push(note.id); // track by Granola note.id, not by saved meeting field
        alreadyImported.add(note.id);  // prevent double-import within the same run
      } catch (e) {
        errors.push(`${note.title || note.id}: ${e.message}`);
      }
    }

    cursor = next_cursor;
    pagesFetched++;
  } while (cursor && pagesFetched < 3);

  // Persist the newly imported note IDs so re-syncs don't create duplicates
  if (importedNoteIds.length > 0) {
    await markNotesImported(importedNoteIds);
  }

  return { imported, skipped, errors };
}

/**
 * Sync Granola meetings across ALL active deals.
 * Useful for a global "sync all" button on the pipeline page (future).
 *
 * @param {object[]} deals — array of deal objects
 * @param {string}   apiKey
 * @returns {{ totalImported: number, byDeal: { [dealId]: number }, errors: string[] }}
 */
export async function syncAllDeals(deals, apiKey) {
  if (!apiKey) throw new Error('No Granola API key configured');

  const byDeal  = {};
  const errors  = [];
  const alreadyImported = await loadImportedNoteIds();
  const newlyImportedIds = [];

  // Fetch all recent notes once, then match to deals
  const allNotes = [];
  let cursor = null;
  let pagesFetched = 0;

  // Look back 90 days by default for the initial full sync
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  do {
    const { notes, next_cursor } = await fetchGranolaNotes(apiKey, {
      updatedAfter: ninetyDaysAgo,
      cursor,
      pageSize: 30,
    });
    allNotes.push(...notes);
    cursor = next_cursor;
    pagesFetched++;
  } while (cursor && pagesFetched < 10);

  // Match each note to the best deal
  for (const note of allNotes) {
    if (alreadyImported.has(note.id)) continue;

    const matchedDeal = matchNoteToDeal(note, deals);
    if (!matchedDeal) continue;

    try {
      await importNote(note, matchedDeal.id, apiKey);
      byDeal[matchedDeal.id] = (byDeal[matchedDeal.id] || 0) + 1;
      newlyImportedIds.push(note.id);
      alreadyImported.add(note.id);
    } catch (e) {
      errors.push(`${note.title || note.id}: ${e.message}`);
    }
  }

  if (newlyImportedIds.length > 0) {
    await markNotesImported(newlyImportedIds);
  }

  return {
    totalImported: newlyImportedIds.length,
    byDeal,
    errors,
  };
}
