// ── Reminder system (localStorage + browser Notification API) ─────────────────
//
// Reminders are stored in localStorage keyed by task id.
// On app load, App.jsx calls checkAndFireReminders() to pop due notifications.

const KEY = 'ph_reminders_v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function saveReminder({ id, title, company, assigned_to, due_date }) {
  const all = load();
  const existing = all.find(r => r.id === id);
  const rest = all.filter(r => r.id !== id);
  const today = new Date().toISOString().slice(0, 10);
  // Re-arm only if due date was pushed to a future date; otherwise keep fired status
  const dueDatePushed = existing?.fired && due_date >= today && existing.due_date !== due_date;
  const fired = dueDatePushed ? false : (existing?.fired ?? false);
  save([...rest, { id, title, company, assigned_to, due_date, fired }]);
}

export function clearReminder(id) {
  save(load().filter(r => r.id !== id));
}

export function hasReminder(id) {
  return load().some(r => r.id === id);
}

export async function requestAndSave(reminderData) {
  if (!('Notification' in window)) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  saveReminder(reminderData);
  return true;
}

export async function checkAndFireReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const today = new Date().toISOString().slice(0, 10);
  const all   = load();
  const due   = all.filter(r => !r.fired && r.due_date && r.due_date <= today);

  due.forEach(r => {
    const isOverdue = r.due_date < today;
    new Notification(isOverdue ? `⚠ Overdue: ${r.title}` : `📋 Due today: ${r.title}`, {
      body: `${r.company}${r.assigned_to ? ` · ${r.assigned_to}` : ''}`,
      icon: '/ph-logo.svg',
      tag:  r.id,
    });
  });

  if (due.length > 0) {
    save(all.map(r => due.find(d => d.id === r.id) ? { ...r, fired: true } : r));
  }
}
