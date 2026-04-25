const express = require('express');
const path    = require('path');
const pool    = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

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
        COUNT(DISTINCT p.id)::int   AS post_count,
        COUNT(DISTINCT cm.id)::int  AS comment_count,
        GREATEST(
          COALESCE(MAX(p.created_at), 'epoch'::timestamp),
          COALESCE(MAX(cm.created_at), 'epoch'::timestamp)
        )                           AS last_activity
      FROM categories c
      LEFT JOIN posts p
        ON p.category_id = c.id
       AND p.visibility = 'public'
       AND p.status = 'published'
      LEFT JOIN comments cm ON cm.post_id = p.id
      GROUP BY c.id, c.name, c.description, c.icon, c.slug
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
        p.id, p.title, p.slug, p.body, p.created_at, p.updated_at,
        u.username AS author,
        u.role     AS author_role,
        COUNT(DISTINCT cm.id)::int AS comment_count,
        MAX(cm.created_at)         AS last_comment_at,
        (
          SELECT u2.username
          FROM comments cm2
          JOIN users u2 ON u2.id = cm2.user_id
          WHERE cm2.post_id = p.id
          ORDER BY cm2.created_at DESC
          LIMIT 1
        ) AS last_comment_by
      FROM posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN comments cm ON cm.post_id = p.id
      WHERE p.category_id = $1
        AND p.visibility = 'public'
        AND p.status = 'published'
      GROUP BY p.id, p.title, p.slug, p.body, p.created_at, p.updated_at, u.username, u.role
      ORDER BY COALESCE(MAX(cm.created_at), p.created_at) DESC
    `, [category.id]);

    res.json({ category, posts: threadsResult.rows });
  } catch (err) {
    console.error('GET /api/categories/:slug error:', err);
    res.status(500).json({ error: 'Failed to load category.' });
  }
});

// ── API: article + comments ─────────────────────────────────────────────────

router.get('/api/posts/:id', requireLogin, async (req, res) => {
  const postId = req.params.id;
  if (!isUuid(postId)) return res.status(400).json({ error: 'Invalid post ID.' });

  try {
    const articleResult = await pool.query(`
      SELECT p.id, p.title, p.slug, p.body, p.created_at, p.updated_at,
             p.author_id, p.category_id,
             u.username AS author,
             u.role     AS author_role,
             c.name     AS category_name,
             c.slug     AS category_slug,
             p.visibility,
             p.status
      FROM posts p
      JOIN users u ON u.id = p.author_id
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1
        AND (
          (p.visibility = 'public' AND p.status = 'published')
          OR p.author_id = $2
          OR $3 = 'admin'
        )
    `, [postId, req.session.user.id, req.session.user.role]);

    if (!articleResult.rows.length) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const commentsResult = await pool.query(`
      SELECT c.id, c.post_id, c.user_id, c.parent_comment_id,
             c.content, c.is_edited, c.is_deleted,
             c.created_at, c.updated_at,
             u.username, u.role
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [postId]);

    res.json({ article: articleResult.rows[0], comments: commentsResult.rows });
  } catch (err) {
    console.error('GET /api/posts/:id error:', err);
    res.status(500).json({ error: 'Failed to load post.' });
  }
});

// ── API: create article ──────────────────────────────────────────────────────

router.post('/api/posts', requireLogin, async (req, res) => {
  const { title, content, categoryId } = req.body;
  const userId = req.session.user.id;

  if (!title?.trim() || !content?.trim() || !categoryId) {
    return res.status(400).json({ error: 'Title, content and category are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const postResult = await client.query(
      `INSERT INTO posts (author_id, title, slug, body, visibility, status, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        userId,
        title.trim(),
        `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
        content.trim(),
        'public',
        'published',
        categoryId,
      ]
    );
    const postId = postResult.rows[0].id;

    await client.query('COMMIT');
    res.status(201).json({ postId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/posts error:', err);
    res.status(500).json({ error: 'Failed to create post.' });
  } finally {
    client.release();
  }
});

// ── API: create comment ──────────────────────────────────────────────────────

router.post('/api/comments', requireLogin, async (req, res) => {
  const { content, postId, parentCommentId } = req.body;
  const userId = req.session.user.id;

  if (!content?.trim() || !isUuid(postId)) {
    return res.status(400).json({ error: 'Content and postId are required.' });
  }

  if (parentCommentId && !isUuid(parentCommentId)) {
    return res.status(400).json({ error: 'Invalid parent comment ID.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, content, parent_comment_id)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [
        postId,
        userId,
        content.trim(),
        parentCommentId || null,
      ]
    );

    res.status(201).json({ commentId: result.rows[0].id });
  } catch (err) {
    console.error('POST /api/comments error:', err);
    res.status(500).json({ error: 'Failed to create comment.' });
  }
});

// ── API: delete post/article ────────────────────────────────────────────────

router.delete('/api/posts/:id', requireLogin, async (req, res) => {
  const postId = req.params.id;
  if (!isUuid(postId)) return res.status(400).json({ error: 'Invalid post ID.' });

  const { id: userId, role } = req.session.user;

  try {
    const postResult = await pool.query(
      'SELECT author_id FROM posts WHERE id = $1',
      [postId]
    );

    if (!postResult.rows.length) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    // Only the post author or an admin may delete
    if (postResult.rows[0].author_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/posts/:id error:', err);
    res.status(500).json({ error: 'Failed to delete post.' });
  }
});

// ── API: delete comment ──────────────────────────────────────────────────────

router.delete('/api/comments/:id', requireLogin, async (req, res) => {
  const commentId = req.params.id;
  if (!isUuid(commentId)) return res.status(400).json({ error: 'Invalid comment ID.' });

  const { id: userId, role } = req.session.user;

  try {
    const threadResult = await pool.query(
      'SELECT user_id FROM comments WHERE id = $1',
      [commentId]
    );

    if (!threadResult.rows.length) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    if (threadResult.rows[0].user_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/comments/:id error:', err);
    res.status(500).json({ error: 'Failed to delete comment.' });
  }
});

module.exports = router;
