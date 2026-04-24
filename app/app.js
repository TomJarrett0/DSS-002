require('dotenv').config();

const express        = require('express');
const session        = require('express-session');
const pgSession      = require('connect-pg-simple')(session);
const path           = require('path');
const pool           = require('./db/pool');

const authRoutes  = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const adminRoutes = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

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
