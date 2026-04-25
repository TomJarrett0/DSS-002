const express = require('express');
const bcrypt  = require('bcrypt');
const path    = require('path');
const pool    = require('../db/pool');
const { redirectIfLoggedIn } = require('../middleware/auth');

const router = express.Router();

const SALT_ROUNDS = 12;

// Dummy hash used when the username doesn't exist so bcrypt.compare always
// runs — prevents timing-based username enumeration.
const DUMMY_HASH = '$2b$12$invalidhashplaceholder.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ── Login ─────────────────────────────────────────────────────────────────────

router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/login.html'));
});

router.post('/login', redirectIfLoggedIn, async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username?.trim() ?? '']
    );

    const user = result.rows[0];

    // Always run compare regardless of whether the user exists to prevent
    // timing attacks that could reveal valid usernames.
    const hashToCompare = user ? user.password_hash : DUMMY_HASH;
    const valid = await bcrypt.compare(password ?? '', hashToCompare);

    if (!user || !valid) {
      // Generic message — same response whether username or password is wrong.
      return res.redirect('/login?error=invalid');
    }

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

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

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
