const express = require('express');
const path    = require('path');
const pool    = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// ── Page routes (serve HTML shells) ──────────────────────────────────────────

router.get('/', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/forum.html'));
});

router.get('/category/:slug', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/category.html'));
});

router.get('/thread/:id', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/thread.html'));
});

// ── API: current user ─────────────────────────────────────────────────────────

router.get('/api/me', requireLogin, (req, res) => {
  res.json({ user: req.session.user });
});

// ── API: categories ───────────────────────────────────────────────────────────

router.get('/api/categories', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.name, c.description, c.icon, c.slug,
        COUNT(DISTINCT t.id)::int  AS thread_count,
        COUNT(DISTINCT p.id)::int  AS post_count,
        MAX(p.created_at)          AS last_activity
      FROM categories c
      LEFT JOIN threads t ON t.category_id = c.id
      LEFT JOIN posts   p ON p.thread_id   = t.id
      GROUP BY c.id
      ORDER BY c.id
    `);
    res.json({ categories: result.rows });
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: 'Failed to load categories.' });
  }
});

// ── API: threads in a category ────────────────────────────────────────────────

router.get('/api/categories/:slug', requireLogin, async (req, res) => {
  try {
    const catResult = await pool.query(
      'SELECT * FROM categories WHERE slug = $1',
      [req.params.slug]
    );
    if (!catResult.rows.length) {
      return res.status(404).json({ error: 'Category not found.' });
    }
    const category = catResult.rows[0];

    const threadsResult = await pool.query(`
      SELECT
        t.id, t.title, t.created_at, t.updated_at,
        u.username AS author,
        COUNT(p.id)::int                          AS reply_count,
        MAX(p.created_at)                         AS last_reply_at,
        (SELECT username FROM users WHERE id =
          (SELECT user_id FROM posts WHERE thread_id = t.id
           ORDER BY created_at DESC LIMIT 1))     AS last_reply_by
      FROM threads t
      JOIN users  u ON u.id = t.user_id
      LEFT JOIN posts p ON p.thread_id = t.id
      WHERE t.category_id = $1
      GROUP BY t.id, u.username
      ORDER BY COALESCE(MAX(p.created_at), t.created_at) DESC
    `, [category.id]);

    res.json({ category, threads: threadsResult.rows });
  } catch (err) {
    console.error('GET /api/categories/:slug error:', err);
    res.status(500).json({ error: 'Failed to load category.' });
  }
});

// ── API: thread + posts ───────────────────────────────────────────────────────

router.get('/api/threads/:id', requireLogin, async (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  if (isNaN(threadId)) return res.status(400).json({ error: 'Invalid thread ID.' });

  try {
    const threadResult = await pool.query(`
      SELECT t.id, t.title, t.created_at, t.category_id,
             u.username AS author,
             c.name AS category_name, c.slug AS category_slug
      FROM threads t
      JOIN users      u ON u.id = t.user_id
      JOIN categories c ON c.id = t.category_id
      WHERE t.id = $1
    `, [threadId]);

    if (!threadResult.rows.length) {
      return res.status(404).json({ error: 'Thread not found.' });
    }

    const postsResult = await pool.query(`
      SELECT p.id, p.content, p.created_at, p.updated_at, p.user_id,
             u.username, u.role
      FROM posts p
      JOIN users u ON u.id = p.user_id
      WHERE p.thread_id = $1
      ORDER BY p.created_at ASC
    `, [threadId]);

    res.json({ thread: threadResult.rows[0], posts: postsResult.rows });
  } catch (err) {
    console.error('GET /api/threads/:id error:', err);
    res.status(500).json({ error: 'Failed to load thread.' });
  }
});

// ── API: create thread ────────────────────────────────────────────────────────

router.post('/api/threads', requireLogin, async (req, res) => {
  const { title, content, categoryId } = req.body;
  const userId = req.session.user.id;

  if (!title?.trim() || !content?.trim() || !categoryId) {
    return res.status(400).json({ error: 'Title, content and category are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const threadResult = await client.query(
      `INSERT INTO threads (title, category_id, user_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [title.trim(), categoryId, userId]
    );
    const threadId = threadResult.rows[0].id;

    await client.query(
      `INSERT INTO posts (content, thread_id, user_id) VALUES ($1, $2, $3)`,
      [content.trim(), threadId, userId]
    );

    await client.query('COMMIT');
    res.status(201).json({ threadId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/threads error:', err);
    res.status(500).json({ error: 'Failed to create thread.' });
  } finally {
    client.release();
  }
});

// ── API: reply to thread ──────────────────────────────────────────────────────

router.post('/api/posts', requireLogin, async (req, res) => {
  const { content, threadId } = req.body;
  const userId = req.session.user.id;

  if (!content?.trim() || !threadId) {
    return res.status(400).json({ error: 'Content and threadId are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO posts (content, thread_id, user_id)
       VALUES ($1, $2, $3) RETURNING id, created_at`,
      [content.trim(), threadId, userId]
    );

    // Update thread's updated_at so it bubbles to top in category view
    await pool.query(
      'UPDATE threads SET updated_at = NOW() WHERE id = $1',
      [threadId]
    );

    res.status(201).json({ postId: result.rows[0].id });
  } catch (err) {
    console.error('POST /api/posts error:', err);
    res.status(500).json({ error: 'Failed to post reply.' });
  }
});

// ── API: delete post ──────────────────────────────────────────────────────────

router.delete('/api/posts/:id', requireLogin, async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (isNaN(postId)) return res.status(400).json({ error: 'Invalid post ID.' });

  const { id: userId, role } = req.session.user;

  try {
    const postResult = await pool.query(
      'SELECT user_id FROM posts WHERE id = $1',
      [postId]
    );

    if (!postResult.rows.length) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    // Only the post author or an admin may delete
    if (postResult.rows[0].user_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/posts/:id error:', err);
    res.status(500).json({ error: 'Failed to delete post.' });
  }
});

// ── API: delete thread ────────────────────────────────────────────────────────

router.delete('/api/threads/:id', requireLogin, async (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  if (isNaN(threadId)) return res.status(400).json({ error: 'Invalid thread ID.' });

  const { id: userId, role } = req.session.user;

  try {
    const threadResult = await pool.query(
      'SELECT user_id FROM threads WHERE id = $1',
      [threadId]
    );

    if (!threadResult.rows.length) {
      return res.status(404).json({ error: 'Thread not found.' });
    }

    if (threadResult.rows[0].user_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    // Cascades to posts via FK constraint
    await pool.query('DELETE FROM threads WHERE id = $1', [threadId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/threads/:id error:', err);
    res.status(500).json({ error: 'Failed to delete thread.' });
  }
});

module.exports = router;
