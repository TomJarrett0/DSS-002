// thread.js — thread view with posts and reply form

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

function buildPostCard(post, index) {
  const card = document.createElement('div');
  card.className  = 'post-card';
  card.id         = `post-${post.id}`;

  // Author column
  const authorCol = document.createElement('div');
  authorCol.className = 'post-author';

  const avatar = document.createElement('div');
  avatar.className   = 'avatar';
  avatar.textContent = getInitials(post.username);

  const name = document.createElement('div');
  name.className   = 'author-name';
  name.textContent = post.username;

  const badge = document.createElement('span');
  badge.className   = `role-badge ${post.role}`;
  badge.textContent = post.role === 'admin' ? 'Admin' : 'Member';

  const postNum = document.createElement('div');
  postNum.className = 'text-xs text-dim';
  postNum.textContent = `#${index + 1}`;

  authorCol.append(avatar, name, badge, postNum);

  // Body column
  const body = document.createElement('div');
  body.className = 'post-body';

  const content = document.createElement('div');
  content.className   = 'post-content';
  content.textContent = post.content;

  const footer = document.createElement('div');
  footer.className = 'post-footer';

  const dateEl = document.createElement('span');
  dateEl.textContent = formatDate(post.created_at);

  footer.appendChild(dateEl);

  // Show delete button for own post or admins
  if (currentUser && (post.user_id === currentUser.id || currentUser.role === 'admin')) {
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deletePost(post.id, card));
    footer.appendChild(delBtn);
  }

  body.append(content, footer);
  card.append(authorCol, body);
  return card;
}

async function deletePost(postId, cardEl) {
  if (!confirm('Delete this post?')) return;

  const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
  if (res.ok) {
    cardEl.remove();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to delete post.');
  }
}

async function loadThread() {
  const res = await fetch(`/api/threads/${threadId}`);
  if (res.status === 404) { window.location.href = '/'; return; }
  if (!res.ok) { return; }

  const { thread, posts } = await res.json();

  document.title = `${thread.title} — GameVault`;

  // Breadcrumb
  const catLink = document.getElementById('breadcrumb-cat');
  catLink.href        = `/category/${thread.category_slug}`;
  catLink.textContent = thread.category_name;
  document.getElementById('breadcrumb-thread').textContent = thread.title;

  // Thread header
  const headerContainer = document.getElementById('thread-header-container');
  headerContainer.textContent = '';
  const header = document.createElement('div');
  header.className = 'thread-header';
  const h1 = document.createElement('h1');
  h1.textContent = thread.title;
  const meta = document.createElement('div');
  meta.className = 'text-sm text-muted';
  meta.textContent = `Started by ${thread.author} · ${new Date(thread.created_at).toLocaleDateString('en-GB')}`;
  header.append(h1, meta);
  headerContainer.appendChild(header);

  // Posts
  const postsContainer = document.getElementById('posts-container');
  postsContainer.textContent = '';
  posts.forEach((post, i) => postsContainer.appendChild(buildPostCard(post, i)));

  // Show reply form
  document.getElementById('reply-box').style.display = 'block';
}

// ── Reply form ────────────────────────────────────────────────────────────────
document.getElementById('reply-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl  = document.getElementById('reply-error');
  errorEl.textContent = '';

  const content = document.getElementById('reply-content').value.trim();
  if (!content) { errorEl.textContent = 'Reply cannot be empty.'; return; }

  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, threadId: parseInt(threadId, 10) }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.error || 'Failed to post reply.';
    return;
  }

  document.getElementById('reply-content').value = '';
  await loadThread();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
});

(async () => {
  await loadUser();
  await loadThread();
})();
