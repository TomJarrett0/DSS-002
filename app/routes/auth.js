const express = require('express');
const bcrypt  = require('bcrypt');
const path    = require('path');
const pool    = require('../db/pool');
const { redirectIfLoggedIn }                                     = require('../middleware/auth');
const { checkAccountLockout, recordFailedAttempt, clearFailedAttempts } = require('../middleware/accountLockout');
const logger  = require('../utils/logger');

const router = express.Router();

// ── Password security constants ───────────────────────────────────────────────
//
// HOW PASSWORD SECURITY WORKS IN THIS PROJECT
// ============================================
//
// Three layers protect stored passwords:
//
// 1. PEPPER (this file, applied before hashing)
//    A secret string stored in .env (never in the database) that is appended
//    to every password before it is hashed. If the database is stolen but the
//    server environment is not, the attacker cannot crack the hashes because
//    they don't have the pepper. Unlike salts, the pepper is the same for all
//    users and must never change after accounts are created.
//
// 2. SALT (handled automatically by bcrypt)
//    bcrypt generates a unique random salt for every hash it produces. The salt
//    is embedded in the stored hash string (the characters after "$2b$12$").
//    This means two users with the same password get completely different hashes,
//    so an attacker cannot use a precomputed rainbow table to crack them in bulk.
//
// 3. HASHING WITH A COST FACTOR (bcrypt)
//    bcrypt is deliberately slow. The cost factor (SALT_ROUNDS = 12) means bcrypt
//    runs 2^12 = 4096 internal iterations. On modern hardware this takes ~250ms —
//    fast enough for a legitimate login but orders of magnitude too slow for an
//    attacker trying billions of guesses. MD5 and plain SHA-256 are NOT suitable
//    for passwords; bcrypt is specifically designed for this use case.
//
// REGISTRATION FLOW:
//   plaintext password  →  password + PEPPER  →  bcrypt.hash()  →  stored hash
//
// LOGIN FLOW:
//   entered password  →  password + PEPPER  →  bcrypt.compare(peppered, storedHash)
//
// ─────────────────────────────────────────────────────────────────────────────

const SALT_ROUNDS = 12;

// The pepper is loaded from the environment so it never touches the database.
// If PASSWORD_PEPPER is missing the app exits immediately — running without a
// pepper would silently produce hashes that cannot be verified after one is added.
const PEPPER = process.env.PASSWORD_PEPPER;
if (!PEPPER) {
  console.error('FATAL: PASSWORD_PEPPER is not set in .env');
  process.exit(1);
}

// Dummy hash used when the username doesn't exist so bcrypt.compare always
// runs — prevents timing-based username enumeration.
const DUMMY_HASH = '$2b$12$invalidhashplaceholder.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ── Login ─────────────────────────────────────────────────────────────────────
//
// BRUTE-FORCE PROTECTION — TWO LAYERS:
//
//   Layer 1 (IP rate limit) is applied in app.js before this router.
//   It blocks an IP that sends more than 10 failed requests in 15 minutes.
//
//   Layer 2 (account lockout) is the checkAccountLockout middleware below.
//   It blocks further attempts on a specific account after 5 failures,
//   regardless of which IP is used. This catches attackers rotating IPs.
//
//   Request flow:
//     [app.js] loginRateLimiter (IP check)
//       → [this route] checkAccountLockout (account check)
//         → bcrypt comparison
//           → fail: recordFailedAttempt() + log FAILED_LOGIN
//           → pass: clearFailedAttempts() + log LOGIN_SUCCESS + redirect
//
// ─────────────────────────────────────────────────────────────────────────────

router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/login.html'));
});

// checkAccountLockout runs as route-level middleware before the handler.
router.post('/login', redirectIfLoggedIn, checkAccountLockout, async (req, res) => {
  const { username, password } = req.body;
  const trimmedUsername = username?.trim() ?? '';

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash, role, is_suspended FROM users WHERE username = $1',
      [trimmedUsername]
    );

    const user = result.rows[0];

    // Always run compare regardless of whether the user exists to prevent
    // timing attacks that could reveal valid usernames.
    // The pepper is appended before comparing — must match exactly how it was
    // applied during registration (password + PEPPER → bcrypt.hash).
    const hashToCompare = user ? user.password_hash : DUMMY_HASH;
    const valid = await bcrypt.compare((password ?? '') + PEPPER, hashToCompare);

    if (!user || !valid) {
      // Record the failure and log it. recordFailedAttempt handles the case
      // where the username doesn't exist (the UPDATE simply matches 0 rows).
      await recordFailedAttempt(trimmedUsername, req.ip);
      logger.warn('FAILED_LOGIN', { username: trimmedUsername, ip: req.ip });

      // Generic message — same response whether username or password is wrong.
      return res.redirect('/login?error=invalid');
    }

    // Block suspended accounts even with valid credentials.
    if (user.is_suspended) {
      return res.redirect('/login?error=suspended');
    }

    // Successful login — reset the failure counter so the user starts clean.
    // clearFailedAttempts also logs LOCKOUT_CLEARED if the account was locked.
    await clearFailedAttempts(trimmedUsername, req.ip);
    logger.info('LOGIN_SUCCESS', { username: trimmedUsername, ip: req.ip });

    // Regenerate the session ID on every successful login to prevent
    // session fixation attacks.
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.redirect('/login?error=server');
      }

      req.session.user = {
        id:       user.id,
        username: user.username,
        role:     user.role,
      };

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.redirect('/login?error=server');
        }

        // All roles land on the forum home. Admins see an "Admin Panel" link
        // in the nav and can navigate to /admin from there.
        res.redirect('/');
      });
    });

  } catch (err) {
    console.error('Login error:', err);
    res.redirect('/login?error=server');
  }
});

// ── Register ──────────────────────────────────────────────────────────────────

router.get('/register', redirectIfLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/register.html'));
});

router.post('/register', redirectIfLoggedIn, async (req, res) => {
  const { username, email, password, confirm_password } = req.body;

  if (!username || !email || !password || !confirm_password) {
    return res.redirect('/register?error=missing');
  }

  const trimmedUsername = username.trim();
  const trimmedEmail    = email.trim().toLowerCase();

  if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
    return res.redirect('/register?error=username_length');
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
    return res.redirect('/register?error=username_chars');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return res.redirect('/register?error=invalid_email');
  }

  if (password.length < 8) {
    return res.redirect('/register?error=weak_password');
  }

  if (password !== confirm_password) {
    return res.redirect('/register?error=mismatch');
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [trimmedUsername, trimmedEmail]
    );

    if (existing.rows.length > 0) {
      // Deliberately generic — doesn't reveal whether username or email is taken.
      return res.redirect('/register?error=taken');
    }

    // Append the server-side pepper before hashing.
    // bcrypt will also generate a unique per-user salt automatically and embed
    // it in the resulting hash string — so the stored value is protected by
    // both the pepper (server secret) and the salt (per-user random value).
    const passwordHash = await bcrypt.hash(password + PEPPER, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, username, role`,
      [trimmedUsername, trimmedEmail, passwordHash]
    );

    const newUser = result.rows[0];

    req.session.regenerate((err) => {
      if (err) return res.redirect('/register?error=server');

      req.session.user = {
        id:       newUser.id,
        username: newUser.username,
        role:     newUser.role,
      };

      req.session.save((err) => {
        if (err) return res.redirect('/register?error=server');
        res.redirect('/');
      });
    });

  } catch (err) {
    console.error('Register error:', err);
    res.redirect('/register?error=server');
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;
