/**
 * requireLogin - protects any route that needs an authenticated user.
 * Redirects unauthenticated visitors to /login.
 */
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

/**
 * requireAdmin - protects admin-only routes.
 * Returns 403 if the authenticated user is not an admin.
 */
function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('<h1>403 — Forbidden</h1><p>You do not have permission to access this page.</p><a href="/">Go home</a>');
  }
  next();
}

/**
 * redirectIfLoggedIn - sends already-authenticated users away from
 * login/register pages directly to the forum home.
 */
function redirectIfLoggedIn(req, res, next) {
  if (req.session.user) {
    return res.redirect('/');
  }
  next();
}

/**
 * requirePostOwner - ensures the authenticated user owns the post identified
 * by req.params.id. Attaches the post row to req.post so handlers can skip
 * the ownership DB query. Admins are NOT granted override here — this is
 * intentionally author-only (edit/publish/unpublish are author actions).
 */
const pool = require('../db/pool');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requirePostOwner(req, res, next) {
  const postId = req.params.id;
  if (!UUID_RE.test(postId)) {
    return res.status(400).json({ error: 'Invalid post ID.' });
  }
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    const result = await pool.query(
      'SELECT id, author_id, title, slug, body, status, visibility, category_id FROM posts WHERE id = $1',
      [postId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Post not found.' });
    }
    if (result.rows[0].author_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    req.post = result.rows[0];
    next();
  } catch (err) {
    console.error('requirePostOwner error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
}

module.exports = { requireLogin, requireAdmin, redirectIfLoggedIn, requirePostOwner };
