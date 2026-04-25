const express        = require('express');
const path           = require('path');
const pool           = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// ── Page route ────────────────────────────────────────────────────────────────

router.get('/dashboard', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/dashboard.html'));
});

// ── API: author's own posts (drafts + published) ──────────────────────────────

router.get('/api/dashboard/posts', requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const result = await pool.query(`
      SELECT p.id, p.title, p.slug, p.body, p.status, p.visibility,
             p.created_at, p.updated_at,
             c.id   AS category_id,
             c.name AS category_name
      FROM posts p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.author_id = $1
      ORDER BY p.updated_at DESC
    `, [userId]);

    const drafts    = result.rows.filter(p => p.status === 'draft');
    const published = result.rows.filter(p => p.status === 'published');
    res.json({ drafts, published });
  } catch (err) {
    console.error('GET /api/dashboard/posts error:', err);
    res.status(500).json({ error: 'Failed to load posts.' });
  }
});

// ── API: edit a post (author only) ────────────────────────────────────────────

router.put('/api/posts/:id', requireLogin, async (req, res) => {
  const postId = req.params.id;
  if (!isUuid(postId)) return res.status(400).json({ error: 'Invalid post ID.' });

  const { title, body, categoryId } = req.body;
  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Title and body are required.' });
  }

  const userId = req.session.user.id;

  try {
    const check = await pool.query('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Post not found.' });
    if (check.rows[0].author_id !== userId) return res.status(403).json({ error: 'Forbidden.' });

    const slug = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
    const result = await pool.query(
      `UPDATE posts
          SET title = $1, slug = $2, body = $3, category_id = $4, updated_at = NOW()
        WHERE id = $5
        RETURNING id, title, slug, body, status, visibility, updated_at`,
      [title.trim(), slug, body.trim(), categoryId || null, postId]
    );
    res.json({ post: result.rows[0] });
  } catch (err) {
    console.error('PUT /api/posts/:id error:', err);
    res.status(500).json({ error: 'Failed to update post.' });
  }
});

// ── API: publish / unpublish a post (author only) ─────────────────────────────

router.patch('/api/posts/:id/status', requireLogin, async (req, res) => {
  const postId = req.params.id;
  if (!isUuid(postId)) return res.status(400).json({ error: 'Invalid post ID.' });

  const { status } = req.body;
  if (!['published', 'draft'].includes(status)) {
    return res.status(400).json({ error: 'status must be "published" or "draft".' });
  }

  const userId     = req.session.user.id;
  const visibility = status === 'published' ? 'public' : 'private';

  try {
    const check = await pool.query('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Post not found.' });
    if (check.rows[0].author_id !== userId) return res.status(403).json({ error: 'Forbidden.' });

    const result = await pool.query(
      `UPDATE posts
          SET status = $1, visibility = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, status, visibility`,
      [status, visibility, postId]
    );
    res.json({ post: result.rows[0] });
  } catch (err) {
    console.error('PATCH /api/posts/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update post status.' });
  }
});

module.exports = router;
