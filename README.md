# GameVault — Secure Videogame Forum

A secure, session-based forum for videogame discussion built with Node.js, Express, and PostgreSQL.

---

## Running the application

1. Copy `.env.example` to `.env` and fill in your database credentials and session secret.
2. Run the schema against your PostgreSQL database to create tables and seed categories:
   ```
   psql $DATABASE_URL -f app/db/schema.sql
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Start the server:
   ```
   npm start
   ```
   The app runs on `http://localhost:3000` (or the `PORT` in your `.env`).

---

## Environment variables (`.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | Full PostgreSQL connection string (`postgresql://user:pass@host:port/db`) |
| `SESSION_SECRET` | Long random string used to sign session cookies (keep this secret) |
| `PORT` | Port the server listens on (default: 3000) |
| `NODE_ENV` | `development` or `production` — affects cookie security settings |

---

## Features

- **Registration & login** with hashed passwords (bcrypt)
- **Secure session handling** — session ID is regenerated on every login to prevent session fixation
- **Generic error messages** — login always shows the same failure message whether the username or password is wrong, preventing username enumeration attacks
- **Role-based access** — two roles: `user` and `admin`. Admins can access `/admin` from the nav
- **Forum categories** — seeded from `app/db/schema.sql`; admins can add/delete categories
- **Threads and replies** — users can start threads in any category and reply to any thread
- **Post deletion** — users can delete their own posts; admins can delete any post or thread
- **Session storage in PostgreSQL** — sessions survive server restarts

---

## New dependencies explained

### `bcrypt`
**What it is:** A password-hashing library.

**How it works:** When a user registers, instead of storing their plain-text password, we run it through bcrypt which applies a slow, salted hashing algorithm (Blowfish cipher). The result (e.g. `$2b$12$...`) is what gets stored in the database. On login, bcrypt re-hashes the entered password with the same salt embedded in the stored hash and compares the results — the original password is never stored or needed again.

**Why it matters:** Even if the database is compromised, attackers get only hashes — cracking bcrypt is intentionally slow (the `12` in `$2b$12$` is the "cost factor": 2^12 = 4096 rounds). Plain SHA-256 or MD5 hashing is not suitable for passwords; bcrypt is specifically designed for this.

**Usage in this project:** `app/routes/auth.js` — `bcrypt.hash()` on register, `bcrypt.compare()` on login. We always call `bcrypt.compare()` even when the username doesn't exist (using a dummy hash), so an attacker cannot tell from response time whether a username is valid.

---

### `express-session`
**What it is:** Session middleware for Express.

**How it works:** On first request, it creates a unique session ID, stores it in a signed HTTP cookie (`connect.sid`), and keeps a corresponding record server-side (in our case, in PostgreSQL via `connect-pg-simple`). On every subsequent request the browser sends the cookie, the middleware looks up the session record, and attaches the session data to `req.session`. When the user logs in we call `req.session.regenerate()` to create a **new** session ID — this prevents session fixation attacks where an attacker pre-plants a known session ID.

**Key cookie settings used:**
- `httpOnly: true` — JavaScript in the browser cannot read the cookie (blocks XSS theft)
- `secure: true` (in production) — cookie is only sent over HTTPS
- `sameSite: 'strict'` — cookie is not sent on cross-site requests (mitigates CSRF)
- `maxAge: 24h` — sessions expire automatically after a day

**Usage in this project:** `app/app.js` configures the session middleware. `app/routes/auth.js` uses `req.session.regenerate()` on login and `req.session.destroy()` on logout. Protected routes check `req.session.user` via `app/middleware/auth.js`.

---

### `connect-pg-simple`
**What it is:** A PostgreSQL session store adapter for `express-session`.

**How it works:** By default, `express-session` stores sessions in memory — this is fine for development but means all sessions are lost when the server restarts and it doesn't scale across multiple server instances. `connect-pg-simple` replaces the in-memory store with a PostgreSQL table (`session`). The table schema is created by `app/db/schema.sql`. The library also automatically cleans up expired session rows on a configurable interval.

**Usage in this project:** `app/app.js` — the `store: new pgSession({ pool })` option passed to `session()`. The pool comes from `app/db/pool.js` which reads `DATABASE_URL` from the environment.

---

## Project structure

```
app/
  app.js                  Main Express server — session, routes, static files
  db/
    pool.js               PostgreSQL connection pool (reads DATABASE_URL)
    schema.sql            Table definitions + seeded categories (run once)
  middleware/
    auth.js               requireLogin, requireAdmin, redirectIfLoggedIn
  routes/
    auth.js               GET/POST /login, /register, POST /logout
    forum.js              Forum pages + JSON API (/api/categories, /api/threads, /api/posts)
    admin.js              Admin panel page + JSON API (/admin/api/*)
  public/
    css/style.css         Dark gaming theme design system
    html/
      login.html          Login page
      register.html       Registration page
      forum.html          Forum home (category listing)
      category.html       Thread listing for a category
      thread.html         Thread view with posts and reply form
      admin.html          Admin panel
    js/
      forum.js            Category grid rendering
      category.js         Thread listing + new thread modal
      thread.js           Post cards + reply form
      admin.js            Stats, user management, category management
```

---

## Security notes

- Passwords are hashed with bcrypt (cost factor 12) — never stored in plain text
- Session IDs are regenerated on login (prevents session fixation)
- Login always returns the same generic error message regardless of failure cause (prevents username enumeration)
- `bcrypt.compare()` runs even for non-existent users to prevent timing-based enumeration
- Session cookies are `httpOnly`, `sameSite: strict`, and `secure` in production
- SQL queries use parameterised placeholders (`$1`, `$2`, …) — not string concatenation — preventing SQL injection
- Frontend uses `textContent` and DOM methods rather than `innerHTML` to prevent XSS
- Users can only delete their own posts; admins can delete any content
