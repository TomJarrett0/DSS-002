// forum.js — forum home page (category listing)

async function loadUser() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login'; return null; }
  const { user } = await res.json();

  document.getElementById('nav-username').textContent = user.username;

  if (user.role === 'admin') {
    document.getElementById('nav-admin-badge').style.display = 'inline';
    document.getElementById('nav-admin-link').style.display  = 'inline-flex';
  }
  return user;
}

function formatRelative(dateStr) {
  if (!dateStr) return 'No activity yet';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)   return 'Just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 30)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB');
}

function buildCategoryCard(cat) {
  const a = document.createElement('a');
  a.className = 'category-card';
  a.href      = `/category/${cat.slug}`;

  const icon = document.createElement('div');
  icon.className   = 'cat-icon';
  icon.textContent = cat.icon;

  const body = document.createElement('div');
  body.className = 'cat-body';

  const name = document.createElement('div');
  name.className   = 'cat-name';
  name.textContent = cat.name;

  const desc = document.createElement('div');
  desc.className   = 'cat-desc';
  desc.textContent = cat.description;

  const meta = document.createElement('div');
  meta.className = 'cat-meta';

  const articleStat = document.createElement('span');
  articleStat.textContent = `📝 ${cat.post_count} posts`;

  const commentStat = document.createElement('span');
  commentStat.textContent = `💬 ${cat.comment_count} comments`;

  const activity = document.createElement('span');
  activity.textContent = `🕐 ${formatRelative(cat.last_activity)}`;

  meta.append(articleStat, commentStat, activity);
  body.append(name, desc, meta);
  a.append(icon, body);
  return a;
}

async function loadCategories() {
  const container = document.getElementById('categories-container');

  const res = await fetch('/api/categories');
  if (!res.ok) {
    container.textContent = 'Failed to load categories.';
    return;
  }

  const { categories } = await res.json();
  container.textContent = '';

  if (!categories.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('div');
    icon.className   = 'empty-icon';
    icon.textContent = '📭';
    const p = document.createElement('p');
    p.textContent = 'No categories yet. Ask an admin to set some up.';
    empty.append(icon, p);
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'category-grid';
  categories.forEach(cat => grid.appendChild(buildCategoryCard(cat)));
  container.appendChild(grid);
}

(async () => {
  await loadUser();
  await loadCategories();
})();
