// category.js — category page (thread listing + new thread modal)

const slug = window.location.pathname.split('/').pop();
let categoryId = null;
let currentUser = null;

async function loadUser() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login'; return null; }
  const { user } = await res.json();
  currentUser = user;
  document.getElementById('nav-username').textContent = user.username;
  if (user.role === 'admin') {
    document.getElementById('nav-admin-badge').style.display = 'inline';
    document.getElementById('nav-admin-link').style.display  = 'inline-flex';
  }
  return user;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function formatRelative(dateStr) {
  if (!dateStr) return '—';
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

function buildArticleItem(post) {
  const row = document.createElement('div');
  row.className = 'thread-item';

  const info = document.createElement('div');

  const titleEl = document.createElement('div');
  titleEl.className = 'thread-title';
  const link = document.createElement('a');
  link.href        = `/thread/${post.id}`;
  link.textContent = post.title;
  titleEl.appendChild(link);

  const meta = document.createElement('div');
  meta.className = 'thread-meta';
  const bySpan = document.createElement('span');
  bySpan.textContent = `by ${post.author}`;
  const dateSpan = document.createElement('span');
  dateSpan.textContent = formatDate(post.created_at);
  meta.append(bySpan, dateSpan);

  info.append(titleEl, meta);

  const stats = document.createElement('div');
  stats.className = 'thread-stats';
  const replyCount = document.createElement('span');
  replyCount.className   = 'reply-count';
  replyCount.textContent = post.comment_count;
  const replyLabel = document.createElement('span');
  replyLabel.textContent = 'comments';
  const lastReply = document.createElement('div');
  lastReply.textContent = `Last: ${formatRelative(post.last_comment_at)}`;
  stats.append(replyCount, replyLabel, lastReply);

  row.append(info, stats);
  return row;
}

async function loadCategory() {
  const res = await fetch(`/api/categories/${slug}`);
  if (res.status === 404) { window.location.href = '/'; return; }
  if (!res.ok) { return; }

  const { category, posts } = await res.json();
  categoryId = category.id;

  document.title = `${category.name} — GameVault`;
  document.getElementById('breadcrumb-cat').textContent = category.name;
  document.getElementById('page-title').textContent = `${category.icon} ${category.name}`;

  const container = document.getElementById('threads-container');
  container.textContent = '';

  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('div');
    icon.className   = 'empty-icon';
    icon.textContent = '💬';
    const p = document.createElement('p');
    p.textContent = 'No posts yet. Be the first to publish one!';
    empty.append(icon, p);
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'thread-list';
  posts.forEach(post => list.appendChild(buildArticleItem(post)));
  container.appendChild(list);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
const overlay  = document.getElementById('modal-overlay');
const closeBtn = document.getElementById('modal-close');
const openBtn  = document.getElementById('new-thread-btn');
const form     = document.getElementById('new-thread-form');

openBtn.addEventListener('click', () => overlay.classList.add('open'));
closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) overlay.classList.remove('open');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('thread-form-error');
  errorEl.textContent = '';

  const title   = document.getElementById('thread-title').value.trim();
  const content = document.getElementById('thread-content').value.trim();

  if (!title || !content) {
    errorEl.textContent = 'Please fill in all fields.';
    return;
  }

  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, categoryId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.error || 'Failed to create thread.';
    return;
  }

  const { postId } = await res.json();
  window.location.href = `/thread/${postId}`;
});

(async () => {
  await loadUser();
  await loadCategory();
})();
