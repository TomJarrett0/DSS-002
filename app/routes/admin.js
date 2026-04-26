const express = require('express');
const bcrypt  = require('bcrypt');
const path    = require('path');
const pool    = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const PEPPER = process.env.PASSWORD_PEPPER;

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// All routes in this file require admin role (enforced in middleware)

// ── Admin panel page ──────────────────────────────────────────────────────────

router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/admin.html'));
});

// ── API: forum stats ──────────────────────────────────────────────────────────

router.get('/api/stats', requireAdmin, async (req, res) => {
  try {
    const [users, posts, comments, categories] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT COUNT(*)::int AS count FROM posts'),
      pool.query('SELECT COUNT(*)::int AS count FROM comments'),
      pool.query('SELECT COUNT(*)::int AS count FROM categories'),
    ]);

    res.json({
      userCount:     users.rows[0].count,
      postCount:     posts.rows[0].count,
      commentCount:  comments.rows[0].count,
      categoryCount: categories.rows[0].count,
    });
  } catch (err) {
    console.error('GET /admin/api/stats error:', err);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// ── API: list all users ───────────────────────────────────────────────────────

router.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, email, role, is_suspended, created_at
      FROM users
      ORDER BY created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (err) {
    console.error('GET /admin/api/users error:', err);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

// ── API: change a user's role ─────────────────────────────────────────────────

router.patch('/api/users/:id/role', requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid user ID.' });

  const { role, confirmPassword } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "user" or "admin".' });
  }

  if (targetId === req.session.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }

  // Re-authenticate the admin before making role changes
  if (!confirmPassword) {
    return res.status(400).json({ error: 'Your password is required to change roles.' });
  }
  try {
    const adminRow = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.session.user.id]
    );
    const valid = await bcrypt.compare(confirmPassword + PEPPER, adminRow.rows[0].password_hash);
    if (!valid) {
      return res.status(403).json({ error: 'Incorrect password.' });
    }
  } catch (err) {
    console.error('Re-auth error in PATCH role:', err);
    return res.status(500).json({ error: 'Server error during re-authentication.' });
  }

  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role',
      [role, targetId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('PATCH /admin/api/users/:id/role error:', err);
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

// ── API: suspend / reactivate a user ──────────────────────────────────────────

router.patch('/api/users/:id/suspension', requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid user ID.' });

  if (targetId === req.session.user.id) {
    return res.status(400).json({ error: 'You cannot suspend your own account.' });
  }

  const { suspended, confirmPassword } = req.body;
  if (typeof suspended !== 'boolean') {
    return res.status(400).json({ error: '"suspended" must be a boolean.' });
  }

  if (!confirmPassword) {
    return res.status(400).json({ error: 'Your password is required to change suspension status.' });
  }

  // Re-authenticate
  try {
    const adminRow = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.session.user.id]
    );
    const valid = await bcrypt.compare(confirmPassword + PEPPER, adminRow.rows[0].password_hash);
    if (!valid) {
      return res.status(403).json({ error: 'Incorrect password.' });
    }
  } catch (err) {
    console.error('Re-auth error in PATCH suspension:', err);
    return res.status(500).json({ error: 'Server error during re-authentication.' });
  }

  try {
    // Fetch target user to check role
    const targetRow = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [targetId]
    );
    if (!targetRow.rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (targetRow.rows[0].role === 'admin') {
      return res.status(400).json({ error: 'Cannot suspend an admin. Demote them first.' });
    }

    const result = await pool.query(
      'UPDATE users SET is_suspended = $1 WHERE id = $2 RETURNING id, username, is_suspended',
      [suspended, targetId]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('PATCH /admin/api/users/:id/suspension error:', err);
    res.status(500).json({ error: 'Failed to update suspension status.' });
  }
});

// ── API: delete a user ────────────────────────────────────────────────────────

router.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid user ID.' });

  if (targetId === req.session.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [targetId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/api/users/:id error:', err);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// ── API: list categories ──────────────────────────────────────────────────────

router.get('/api/categories', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM categories ORDER BY id'
    );
    res.json({ categories: result.rows });
  } catch (err) {
    console.error('GET /admin/api/categories error:', err);
    res.status(500).json({ error: 'Failed to load categories.' });
  }
});

// ── API: create category ──────────────────────────────────────────────────────

router.post('/api/categories', requireAdmin, async (req, res) => {
  const { name, description, icon, slug } = req.body;

  if (!name?.trim() || !description?.trim() || !slug?.trim()) {
    return res.status(400).json({ error: 'Name, description and slug are required.' });
  }

  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    const result = await pool.query(
      `INSERT INTO categories (name, description, icon, slug)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), description.trim(), icon?.trim() || '🎮', cleanSlug]
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A category with that slug already exists.' });
    }
    console.error('POST /admin/api/categories error:', err);
    res.status(500).json({ error: 'Failed to create category.' });
  }
});

// ── API: delete category ──────────────────────────────────────────────────────

router.delete('/api/categories/:id', requireAdmin, async (req, res) => {
  const catId = req.params.id;
  if (!isUuid(catId)) return res.status(400).json({ error: 'Invalid category ID.' });

  try {
    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 RETURNING id',
      [catId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Category not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/api/categories/:id error:', err);
    res.status(500).json({ error: 'Failed to delete category.' });
  }
});

module.exports = router;
