// Minimal CSV line parser (handles quoted fields with embedded commas/escaped
// quotes). Shared by SignalWatchPage (company import) and OldGoldPage
// (LinkedIn contact export import) so both stay in sync.
export function parseCsvLine(line) {
  const vals = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = ''; i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else val += line[i++];
      }
      vals.push(val.trim());
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { vals.push(line.slice(i).trim()); break; }
      vals.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return vals;
}

// Parses a full CSV string into an array of row objects keyed by normalized
// (lowercased, non-alphanumeric-stripped) header names.
//
// LinkedIn's "Connections" export starts with a few preamble lines ("Notes:"
// plus an explanatory paragraph) before the real header row — so the header
// isn't always line 0. Scan the first several lines for one that looks like
// a real header (contains "first name", LinkedIn's tell) and start there;
// fall back to line 0 for CSVs that don't have this quirk.
export function parseCsvRows(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  let headerIdx = lines.findIndex(l => /first\s*name/i.test(l));
  if (headerIdx === -1) headerIdx = 0;

  const headers = parseCsvLine(lines[headerIdx]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  return lines.slice(headerIdx + 1).filter(Boolean).map(line => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
    return row;
  });
}
