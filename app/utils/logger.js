// ── Security Event Logger ─────────────────────────────────────────────────────
//
// Writes structured, newline-delimited JSON entries to logs/security.log.
//
// WHY appendFileSync (synchronous)?
//   We use the synchronous variant intentionally. For security events we want
//   the write to complete *before* the HTTP response is sent — if the process
//   crashes between the write and the response, the event is still recorded.
//   The performance cost (~1ms) is acceptable for a login endpoint that is
//   not on the hot path.
//
// LOG FORMAT (one JSON object per line — parseable with jq or grep):
//   { "timestamp": "2025-04-25T12:00:00.000Z", "level": "WARN",
//     "event": "FAILED_LOGIN", "username": "alex", "ip": "127.0.0.1" }
//
// IMPORTANT: Passwords must NEVER appear in log entries. Do not log
//   req.body directly — it contains the raw password field.
//
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../../logs/security.log');

function write(level, event, details = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  });
  try {
    fs.appendFileSync(LOG_PATH, entry + '\n', 'utf8');
  } catch (err) {
    // Fall back to stderr so a log failure never silently swallows an event.
    console.error('[logger] Failed to write to security.log:', err.message);
    console.error('[logger]', entry);
  }
}

module.exports = {
  info:  (event, details) => write('INFO',  event, details),
  warn:  (event, details) => write('WARN',  event, details),
  error: (event, details) => write('ERROR', event, details),
};
