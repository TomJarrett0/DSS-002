// ── Layer 2: Account-Level Lockout ────────────────────────────────────────────
//
// Tracks failed login attempts per user account in the database.
// After LOCKOUT_THRESHOLD consecutive failures the account is locked for
// LOCKOUT_DURATION_MINUTES, regardless of which IP is used.
//
// WHY A SECOND LAYER?
//   The IP rate limiter (Layer 1) stops a single attacker IP from hammering
//   the endpoint. But a sophisticated attacker can rotate through many IP
//   addresses — e.g. a botnet, a VPN, or Tor — and make one or two attempts
//   from each. Layer 1 never triggers, but every attempt still hits the same
//   target account. Layer 2 catches this: once the account's counter reaches
//   the threshold, ALL further attempts are blocked regardless of IP.
//
// DATABASE FIELDS (added by migrations/add_login_security_fields.sql):
//   failed_login_attempts  INTEGER  — incremented on each wrong password
//   lockout_until          TIMESTAMPTZ — NULL = not locked; set when threshold hit
//
// LIFECYCLE:
//   1. Wrong password → recordFailedAttempt() increments the counter.
//   2. Counter reaches LOCKOUT_THRESHOLD → lockout_until is set.
//   3. Future login attempt → checkAccountLockout() sees lockout_until in the
//      future and returns 423 Locked before bcrypt even runs.
//   4. Lockout expires → login succeeds → clearFailedAttempts() resets both
//      fields so the user starts fresh.
//
// WHY 423 (Locked) not 401 (Unauthorised)?
//   423 is semantically correct for "this resource is temporarily locked"
//   and is distinct from 429 (Too Many Requests from Layer 1), making it
//   easy to tell the two layers apart in logs and in browser devtools.
//
// ─────────────────────────────────────────────────────────────────────────────

const pool   = require('../db/pool');
const logger = require('../utils/logger');

// Tune these constants to change lockout policy without touching the logic.
const LOCKOUT_THRESHOLD       = 5;   // failed attempts before lockout
const LOCKOUT_DURATION_MINUTES = 15; // how long the lockout lasts

// ── Middleware: run before bcrypt comparison ──────────────────────────────────
//
// Checks whether the target account is currently locked. If it is, the
// request is rejected immediately — bcrypt never runs, saving CPU and
// preventing further enumeration.
//
// Note: if the username does not exist we call next() and let the route
// handler return the normal generic error. We must not reveal here whether
// a username is valid.

async function checkAccountLockout(req, res, next) {
  const username = req.body.username?.trim();

  // If no username was submitted, pass through and let the route validate.
  if (!username) return next();

  try {
    const result = await pool.query(
      'SELECT lockout_until FROM users WHERE username = $1',
      [username]
    );

    const user = result.rows[0];

    // Unknown username — fall through. The route handler will return a
    // generic error without revealing that the account does not exist.
    if (!user) return next();

    if (user.lockout_until && user.lockout_until > new Date()) {
      logger.warn('LOCKOUT_BLOCKED', {
        username,
        ip:           req.ip,
        lockout_until: user.lockout_until,
      });

      return res.status(423).send(
        'This account is temporarily locked due to too many failed login ' +
        'attempts. Please try again in 15 minutes.'
      );
    }

    next();
  } catch (err) {
    console.error('accountLockout middleware error:', err);
    next(); // fail open — don't block login due to a DB error in the check
  }
}

// ── Helper: call after a failed bcrypt comparison ────────────────────────────
//
// Atomically increments the counter. If the new count meets the threshold,
// sets lockout_until in the same query. Using a single UPDATE avoids a
// race condition that could occur with separate SELECT + UPDATE statements.

async function recordFailedAttempt(username, ip) {
  try {
    const result = await pool.query(
      `UPDATE users
       SET failed_login_attempts = failed_login_attempts + 1,
           lockout_until = CASE
             WHEN failed_login_attempts + 1 >= $1
             THEN NOW() + ($2 || ' minutes')::INTERVAL
             ELSE lockout_until
           END
       WHERE username = $3
       RETURNING failed_login_attempts, lockout_until`,
      [LOCKOUT_THRESHOLD, LOCKOUT_DURATION_MINUTES, username]
    );

    const row = result.rows[0];
    if (!row) return; // user not found — route handler will deal with it

    if (row.lockout_until && row.failed_login_attempts >= LOCKOUT_THRESHOLD) {
      // Threshold just reached — log the lockout event.
      logger.warn('ACCOUNT_LOCKED', {
        username,
        ip,
        failed_login_attempts: row.failed_login_attempts,
        lockout_until:          row.lockout_until,
      });
    }
  } catch (err) {
    console.error('recordFailedAttempt error:', err);
  }
}

// ── Helper: call after a successful bcrypt comparison ────────────────────────
//
// Resets both fields so the user starts with a clean slate. Also logs
// LOCKOUT_CLEARED if the account had been locked, giving a clear lifecycle
// event in the security log (ACCOUNT_LOCKED → LOCKOUT_BLOCKED* → LOCKOUT_CLEARED).

async function clearFailedAttempts(username, ip) {
  try {
    const result = await pool.query(
      `UPDATE users
       SET failed_login_attempts = 0,
           lockout_until = NULL
       WHERE username = $1
       RETURNING failed_login_attempts, lockout_until`,
      [username]
    );

    const row = result.rows[0];
    if (!row) return;

    // If lockout_until was previously set (now cleared), log it separately
    // so the demo can show the full lockout lifecycle in the log file.
    if (row.lockout_until !== null) {
      logger.info('LOCKOUT_CLEARED', { username, ip });
    }
  } catch (err) {
    console.error('clearFailedAttempts error:', err);
  }
}

module.exports = { checkAccountLockout, recordFailedAttempt, clearFailedAttempts };
