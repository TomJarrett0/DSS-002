// ── Layer 1: IP-Based Rate Limiter ────────────────────────────────────────────
//
// Uses express-rate-limit to block an IP address that sends too many failed
// login requests within a sliding time window.
//
// HOW IT WORKS:
//   express-rate-limit keeps an in-memory counter per IP address. Every time
//   a request arrives at POST /login, the counter for that IP increments.
//   Once the counter exceeds MAX_ATTEMPTS, the limiter short-circuits the
//   request with a 429 (Too Many Requests) before it ever reaches the route
//   handler — no database query fires at all.
//
//   The window resets after WINDOW_MINUTES. If the server restarts, counters
//   reset too (in-memory only). For multi-server deployments a shared store
//   (e.g. Redis) would be needed.
//
// WHY skipSuccessfulRequests: true?
//   A legitimate user who logs in successfully should not have that count
//   against them. This flag ensures only failed/error responses (4xx, 5xx)
//   increment the counter — so a real user logging in normally never gets
//   blocked regardless of how many times they use the site.
//
// WHY standardHeaders: true?
//   This adds RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset
//   headers to every response. Useful for the demo — you can open browser
//   devtools and watch the remaining count drop in real time.
//
// THIS IS LAYER 1 OF 2. See app/middleware/accountLockout.js for Layer 2,
// which catches distributed attacks that rotate IPs to evade this limiter.
//
// ─────────────────────────────────────────────────────────────────────────────

const rateLimit = require('express-rate-limit');
const logger    = require('../utils/logger');

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS   = 10;

const loginRateLimiter = rateLimit({
  windowMs: WINDOW_MINUTES * 60 * 1000,
  max:      MAX_ATTEMPTS,

  // Only count failed requests — successful logins don't penalise the IP.
  skipSuccessfulRequests: true,

  // Send standard RateLimit-* headers (IETF draft — visible in devtools).
  standardHeaders: true,
  legacyHeaders:   false,

  // Custom handler runs when the limit is exceeded.
  handler(req, res) {
    logger.warn('RATE_LIMIT_EXCEEDED', {
      ip:      req.ip,
      path:    req.path,
      method:  req.method,
    });

    // Return 429 with a plain-text message. We deliberately do not redirect
    // to the login page here — a redirect would hide the 429 from automated
    // tools and make the rate limit harder to observe.
    res.status(429).send(
      'Too many login attempts. Please wait 15 minutes before trying again.'
    );
  },
});

module.exports = loginRateLimiter;
