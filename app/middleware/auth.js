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

module.exports = { requireLogin, requireAdmin, redirectIfLoggedIn };
