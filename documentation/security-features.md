# Security Features: Rate Limiting & Account Lockout

## Overview

Without brute-force protection, an attacker can try unlimited passwords against any account — there is no cost to guessing. This document describes two complementary layers added to the login endpoint, plus a security event log that records suspicious activity for review.

---

## Architecture: Two Layers

```
POST /login
     │
     ▼
┌─────────────────────────────────────────┐
│  Layer 1: IP Rate Limit                 │  app/middleware/rateLimiter.js
│  > 10 failed requests / IP / 15 min     │  (applied in app.js)
│  → 429 Too Many Requests                │
│  → logs RATE_LIMIT_EXCEEDED             │
└─────────────────────────────────────────┘
     │ (passes through if under limit)
     ▼
┌─────────────────────────────────────────┐
│  Layer 2: Account Lockout               │  app/middleware/accountLockout.js
│  > 5 failed attempts on one account     │
│  → 423 Locked                           │
│  → logs LOCKOUT_BLOCKED                 │
└─────────────────────────────────────────┘
     │ (passes through if not locked)
     ▼
┌─────────────────────────────────────────┐
│  Route Handler: bcrypt comparison       │  app/routes/auth.js
│  Wrong password → recordFailedAttempt() │
│               → logs FAILED_LOGIN       │
│  Right password → clearFailedAttempts() │
│               → logs LOGIN_SUCCESS      │
└─────────────────────────────────────────┘
```

**Why are both layers needed?**

- Layer 1 stops an attacker hammering the endpoint from a **single IP** — 10 attempts and the IP is blocked.
- Layer 1 alone is not enough. A sophisticated attacker can **rotate IP addresses** (VPN, botnet, Tor), sending one or two attempts from each. Layer 1 never triggers, but every attempt still targets the same account.
- Layer 2 stops this. It counts failures **per account** regardless of IP — after 5 failures the account is locked and no further attempts are accepted no matter where they come from.

---

## Layer 1: IP-Based Rate Limiting

**File:** `app/middleware/rateLimiter.js`  
**Package:** `express-rate-limit`  
**Applied in:** `app/app.js` — scoped to `POST /login` only

### Configuration

| Setting | Value | Meaning |
|---|---|---|
| `windowMs` | 15 minutes | Sliding time window |
| `max` | 10 | Maximum requests per IP per window |
| `skipSuccessfulRequests` | `true` | Successful logins do **not** count toward the limit |
| `standardHeaders` | `true` | Sends `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers |

### What happens when the limit is exceeded

1. The limiter short-circuits the request — the route handler never runs, no DB query fires.
2. HTTP **429 Too Many Requests** is returned with a plain-text message.
3. A `RATE_LIMIT_EXCEEDED` entry is written to `logs/security.log`.

### Why `skipSuccessfulRequests: true`?

A legitimate user who logs in correctly should never be blocked. With this flag enabled, only failed attempts (4xx/5xx responses) increment the counter. A user who logs in successfully is not penalised regardless of how many times they use the site.

### Observing Layer 1 in the browser

Open devtools → Network → click the login request. The response headers include:
```
RateLimit-Limit: 10
RateLimit-Remaining: 7
RateLimit-Reset: 1714050000
```

### Limitation

The rate limiter uses an **in-memory store**. Counters reset if the server restarts. For a production multi-server deployment, a shared store (e.g. Redis via `rate-limit-redis`) would be needed.

---

## Layer 2: Account-Level Lockout

**File:** `app/middleware/accountLockout.js`  
**Applied in:** `app/routes/auth.js` — as route-level middleware on `POST /login`

### Database Fields

Two columns were added to the `users` table (see `migrations/add_login_security_fields.sql`):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `failed_login_attempts` | `INTEGER NOT NULL` | `0` | Incremented on each wrong password |
| `lockout_until` | `TIMESTAMPTZ` | `NULL` | `NULL` = not locked; set when threshold is reached |

`TIMESTAMPTZ` (timestamp with time zone) is used so the comparison `lockout_until > NOW()` works correctly regardless of the server's timezone setting.

### Constants

Defined at the top of `accountLockout.js`:

```js
const LOCKOUT_THRESHOLD        = 5;   // failed attempts before lockout
const LOCKOUT_DURATION_MINUTES = 15;  // how long the lockout lasts
```

Change these to tune lockout policy without touching any logic.

### Account Lockout Lifecycle

```
1. Wrong password  →  failed_login_attempts = failed_login_attempts + 1
2. Count reaches 5 →  lockout_until = NOW() + 15 minutes
                      logs ACCOUNT_LOCKED
3. Next attempt    →  checkAccountLockout sees lockout_until in the future
                      returns 423, logs LOCKOUT_BLOCKED
                      (bcrypt does not run — saves CPU)
4. Wait 15 minutes →  lockout_until is now in the past
5. Correct password →  clearFailedAttempts resets count to 0, lockout_until = NULL
                       logs LOCKOUT_CLEARED + LOGIN_SUCCESS
```

### Why 423 (Locked) not 401?

`423 Locked` is semantically correct for "this account is temporarily locked" and is distinct from `429 Too Many Requests` (Layer 1). In the browser devtools and in the log file, the two layers are immediately distinguishable by their status codes.

### Atomic UPDATE

`recordFailedAttempt` uses a single `UPDATE ... RETURNING` query:

```sql
UPDATE users
SET failed_login_attempts = failed_login_attempts + 1,
    lockout_until = CASE
      WHEN failed_login_attempts + 1 >= $1
      THEN NOW() + ($2 || ' minutes')::INTERVAL
      ELSE lockout_until
    END
WHERE username = $3
RETURNING failed_login_attempts, lockout_until
```

The increment and the conditional lockout happen in one round trip. A separate `SELECT` then `UPDATE` could have a race condition under concurrent requests — the atomic query avoids this.

---

## Security Logging

**File:** `app/utils/logger.js`  
**Log location:** `logs/security.log` (project root — excluded from git)

Each entry is a single JSON object on its own line (newline-delimited JSON). This format can be read by a human or piped through `jq` for structured queries.

### Example entries

```json
{"timestamp":"2025-04-25T12:00:01.000Z","level":"INFO","event":"LOGIN_SUCCESS","username":"alex","ip":"127.0.0.1"}
{"timestamp":"2025-04-25T12:00:45.000Z","level":"WARN","event":"FAILED_LOGIN","username":"alex","ip":"127.0.0.1"}
{"timestamp":"2025-04-25T12:01:10.000Z","level":"WARN","event":"ACCOUNT_LOCKED","username":"alex","ip":"127.0.0.1","failed_login_attempts":5,"lockout_until":"2025-04-25T12:16:10.000Z"}
{"timestamp":"2025-04-25T12:01:20.000Z","level":"WARN","event":"LOCKOUT_BLOCKED","username":"alex","ip":"127.0.0.1","lockout_until":"2025-04-25T12:16:10.000Z"}
{"timestamp":"2025-04-25T12:16:30.000Z","level":"INFO","event":"LOCKOUT_CLEARED","username":"alex","ip":"127.0.0.1"}
{"timestamp":"2025-04-25T12:16:30.000Z","level":"WARN","event":"RATE_LIMIT_EXCEEDED","ip":"192.168.1.5","path":"/login","method":"POST"}
```

### Event Reference

| Event | Level | When logged | Key fields |
|---|---|---|---|
| `LOGIN_SUCCESS` | INFO | Correct password, login accepted | `username`, `ip` |
| `FAILED_LOGIN` | WARN | Wrong password | `username`, `ip` |
| `ACCOUNT_LOCKED` | WARN | `failed_login_attempts` hits threshold | `username`, `ip`, `failed_login_attempts`, `lockout_until` |
| `LOCKOUT_BLOCKED` | WARN | Login attempted while account is locked | `username`, `ip`, `lockout_until` |
| `RATE_LIMIT_EXCEEDED` | WARN | IP exceeds Layer 1 limit | `ip`, `path`, `method` |
| `LOCKOUT_CLEARED` | INFO | Successful login clears a previous lockout | `username`, `ip` |

### Important: passwords are never logged

The logger only receives the fields explicitly passed to it — it never receives `req.body` or the password field. This is documented in the logger source. Logging passwords, even accidentally, would be a serious security incident.

### Viewing logs during the demo

```bash
# Pretty-print the full log
cat logs/security.log | jq .

# Watch live as events come in
tail -f logs/security.log | jq .

# Count events by type
cat logs/security.log | jq -r '.event' | sort | uniq -c

# Show only warnings
cat logs/security.log | jq 'select(.level == "WARN")'
```

---

## Database Migration

The two new columns do not exist in the original schema. Run the migration script once against the live database:

```bash
psql $DATABASE_URL -f migrations/add_login_security_fields.sql
```

The script uses `ADD COLUMN IF NOT EXISTS`, so it is safe to run more than once — it will not error or overwrite existing data.

Verify it worked:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('failed_login_attempts', 'lockout_until');
```

---

## Testing the Features

### Setup

```bash
# Start the server
npm start

# In a second terminal, watch the log live
tail -f logs/security.log | jq .
```

### Test 1 — Layer 1: IP Rate Limit

Send 12 login requests with wrong credentials from the same machine:

```bash
for i in {1..12}; do
  echo -n "Request $i: "
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3005/login \
    -d "username=testuser&password=wrongpassword"
done
```

**Expected:** Requests 1–10 return `401`. Requests 11–12 return `429`.  
**Log:** `RATE_LIMIT_EXCEEDED` entry appears on request 11.  
**Headers on request 10:** `RateLimit-Remaining: 0`

### Test 2 — Layer 2: Account Lockout

Restart the server first (resets the in-memory IP counter). Use a valid username with the wrong password exactly 6 times:

```bash
for i in {1..6}; do
  echo -n "Attempt $i: "
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3005/login \
    -d "username=testuser&password=wrongpassword"
done
```

**Expected:** Attempts 1–5 return `401`. Attempt 6 returns `423` (account locked).  
**Log:** `FAILED_LOGIN` × 5, `ACCOUNT_LOCKED`, `LOCKOUT_BLOCKED`.  
**DB verification:**

```sql
SELECT username, failed_login_attempts, lockout_until
FROM users WHERE username = 'testuser';
```

### Test 3 — Lockout Clears on Success

Wait 15 minutes for the lockout to expire (or lower `LOCKOUT_DURATION_MINUTES` to 1 for a quick demo). Log in with the correct password.

**Expected:** Login succeeds. `failed_login_attempts` resets to 0, `lockout_until` becomes NULL.  
**Log:** `LOCKOUT_CLEARED` followed by `LOGIN_SUCCESS`.

### Test 4 — Successful Logins Not Penalised

Log in correctly 20 times. Verify that `RateLimit-Remaining` stays at 10 (successful requests do not count).

---

## Limitations & Future Improvements

| Limitation | Notes |
|---|---|
| IP spoofing / proxies | Layer 1 trusts `req.ip`. Behind a proxy, ensure `app.set('trust proxy', 1)` is configured so the real client IP is used rather than the proxy IP. |
| Shared IPs | A university or office with many users behind one NAT IP could trigger Layer 1 collectively. Consider raising `max` or using per-user rate limiting for shared environments. |
| In-memory store | The Layer 1 counter resets on server restart. Use `rate-limit-redis` for persistence. |
| CAPTCHA | Add a CAPTCHA (e.g. hCaptcha) after 3 failed attempts to slow human-assisted attacks without full lockout. |
| Alerting | Log entries currently go to a file only. In production, pipe to a SIEM or alerting service to notify on repeated `ACCOUNT_LOCKED` events. |
