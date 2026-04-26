// thread.js — article view with comments and comment form

const threadId = window.location.pathname.split('/').pop();
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
  return new Date(dateStr).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getInitials(username) {
  return username.slice(0, 2).toUpperCase();
}

function buildCommentCard(comment, index) {
  const card = document.createElement('div');
  card.className  = 'post-card';
  card.id         = `comment-${comment.id}`;

  // Author column
  const authorCol = document.createElement('div');
  authorCol.className = 'post-author';

  const avatar = document.createElement('div');
  avatar.className   = 'avatar';
  avatar.textContent = getInitials(comment.username || '??');

  const name = document.createElement('div');
  name.className   = 'author-name';
  name.textContent = comment.username || 'Deleted user';

  const badge = document.createElement('span');
  badge.className   = `role-badge ${comment.role || 'user'}`;
  badge.textContent = comment.role === 'admin' ? 'Admin' : 'Member';

  const postNum = document.createElement('div');
  postNum.className = 'text-xs text-dim';
  postNum.textContent = `#${index + 1}`;

  authorCol.append(avatar, name, badge, postNum);

  // Body column
  const body = document.createElement('div');
  body.className = 'post-body';

  const content = document.createElement('div');
  content.className   = 'post-content';
  content.textContent = comment.content;

  const footer = document.createElement('div');
  footer.className = 'post-footer';

  const dateEl = document.createElement('span');
  dateEl.textContent = formatDate(comment.created_at);

  footer.appendChild(dateEl);

  // Show delete button for own post or admins
  if (currentUser && (comment.user_id === currentUser.id || currentUser.role === 'admin')) {
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteComment(comment.id, card));
    footer.appendChild(delBtn);
  }

  body.append(content, footer);
  card.append(authorCol, body);
  return card;
}

async function deleteArticle(postId) {
  if (!confirm('Delete this article?')) return;

  const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
  if (res.ok) {
    window.location.href = '/';
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to delete article.');
  }
}

async function deleteComment(commentId, cardEl) {
  if (!confirm('Delete this comment?')) return;

  const res = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' });
  if (res.ok) {
    cardEl.remove();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to delete comment.');
  }
}

async function loadArticle() {
  const res = await fetch(`/api/posts/${threadId}`);
  if (res.status === 404) { window.location.href = '/'; return; }
  if (!res.ok) { return; }

  const { article, comments } = await res.json();

  document.title = `${article.title} — GameVault`;

  // Breadcrumb
  const catLink = document.getElementById('breadcrumb-cat');
  catLink.href        = `/category/${article.category_slug}`;
  catLink.textContent = article.category_name;
  document.getElementById('breadcrumb-thread').textContent = article.title;

  // Article header
  const headerContainer = document.getElementById('thread-header-container');
  headerContainer.textContent = '';
  const header = document.createElement('div');
  header.className = 'thread-header';
  const h1 = document.createElement('h1');
  h1.textContent = article.title;
  const meta = document.createElement('div');
  meta.className = 'text-sm text-muted';
  meta.textContent = `By ${article.author} · ${new Date(article.created_at).toLocaleDateString('en-GB')}`;
  const body = document.createElement('div');
  body.className = 'post-content';
  body.style.marginTop = '1rem';
  body.textContent = article.body;
  const actions = document.createElement('div');
  actions.className = 'post-footer';
  const published = document.createElement('span');
  published.textContent = `Published ${new Date(article.created_at).toLocaleDateString('en-GB')}`;
  actions.appendChild(published);
  if (currentUser && (article.author_id === currentUser.id || currentUser.role === 'admin')) {
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Delete Article';
    delBtn.addEventListener('click', () => deleteArticle(article.id));
    actions.appendChild(delBtn);
  }
  header.append(h1, meta, body, actions);
  headerContainer.appendChild(header);

  // Comments
  const postsContainer = document.getElementById('posts-container');
  postsContainer.textContent = '';
  if (!comments.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = '';
    const message = document.createElement('p');
    message.textContent = 'No comments yet. Be the first to respond.';
    empty.append(icon, message);
    postsContainer.appendChild(empty);
  } else {
    comments.forEach((comment, i) => postsContainer.appendChild(buildCommentCard(comment, i)));
  }

  // Show comment form
  document.getElementById('reply-box').style.display = 'block';
}

// ── Comment form ─────────────────────────────────────────────────────────────
document.getElementById('reply-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl  = document.getElementById('reply-error');
  errorEl.textContent = '';

  const content = document.getElementById('reply-content').value.trim();
  if (!content) { errorEl.textContent = 'Comment cannot be empty.'; return; }

  const res = await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, postId: threadId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.error || 'Failed to post comment.';
    return;
  }

  document.getElementById('reply-content').value = '';
  await loadArticle();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
});

(async () => {
  await loadUser();
  await loadArticle();
})();
