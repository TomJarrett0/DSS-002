require('dotenv').config();

const express        = require('express');
const session        = require('express-session');
const pgSession      = require('connect-pg-simple')(session);
const path           = require('path');
const fs             = require('fs');
const pool           = require('./db/pool');
const loginRateLimiter = require('./middleware/rateLimiter');

const authRoutes  = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const adminRoutes = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure logs directory exists ──────────────────────────────────────────────
// The security logger uses fs.appendFileSync which throws if the directory
// is missing. We create it here at startup so a fresh clone works out of the box.
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Session configuration ─────────────────────────────────────────────────────
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    pruneSessionInterval: 60 * 15, // clean up expired sessions every 15 min
  }),
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,                                              // block JS access to cookie
    secure:   process.env.NODE_ENV === 'production',            // HTTPS-only in production
    sameSite: 'strict',                                         // CSRF mitigation
    maxAge:   24 * 60 * 60 * 1000,                             // 24 hours
  },
}));

// ── Static assets (CSS, client-side JS, images) ───────────────────────────────
// Note: HTML files are served explicitly by routes so auth middleware applies.
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js',  express.static(path.join(__dirname, 'public/js')));
app.use('/imgs', express.static(path.join(__dirname, 'public/imgs')));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Applied only to the login endpoint — not globally — so normal forum browsing
// is unaffected. This is Layer 1 of brute-force protection (IP-based).
// Layer 2 (account lockout) is inside app/middleware/accountLockout.js.
app.use('/login', loginRateLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/',      authRoutes);
app.use('/',      forumRoutes);
app.use('/admin', adminRoutes);

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send('<h1>404 — Page not found</h1><a href="/">Go home</a>');
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`GameVault Forum running on http://localhost:${PORT}`);
});
