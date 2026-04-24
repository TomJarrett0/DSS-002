// admin.js — admin panel

async function loadUser() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login'; return null; }
  const { user } = await res.json();
  if (user.role !== 'admin') { window.location.href = '/'; return null; }
  document.getElementById('nav-username').textContent = user.username;
  return user;
}

// ── Sidebar navigation ────────────────────────────────────────────────────────
document.querySelectorAll('.admin-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    const section = document.getElementById(`section-${item.dataset.section}`);
    if (section) section.classList.add('active');
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  const res = await fetch('/admin/api/stats');
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById('stat-users').textContent      = data.userCount;
  document.getElementById('stat-threads').textContent    = data.threadCount;
  document.getElementById('stat-posts').textContent      = data.postCount;
  document.getElementById('stat-categories').textContent = data.categoryCount;
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.textContent = '';

  const res = await fetch('/admin/api/users');
  if (!res.ok) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'Failed to load users.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  const { users } = await res.json();

  users.forEach(user => {
    const tr = document.createElement('tr');

    const tdUsername = document.createElement('td');
    tdUsername.textContent = user.username;
    tdUsername.style.fontWeight = '600';

    const tdEmail = document.createElement('td');
    tdEmail.className   = 'text-muted';
    tdEmail.textContent = user.email;

    const tdRole = document.createElement('td');
    const badge = document.createElement('span');
    badge.className   = `role-badge ${user.role}`;
    badge.textContent = user.role;
    tdRole.appendChild(badge);

    const tdJoined = document.createElement('td');
    tdJoined.className   = 'text-muted text-sm';
    tdJoined.textContent = new Date(user.created_at).toLocaleDateString('en-GB');

    const tdActions = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.style.cssText = 'display:flex;gap:0.5rem;align-items:center';

    // Role toggle button
    const roleBtn = document.createElement('button');
    roleBtn.className   = 'btn btn-ghost btn-sm';
    roleBtn.textContent = user.role === 'admin' ? 'Demote' : 'Make Admin';
    roleBtn.addEventListener('click', async () => {
      const newRole = user.role === 'admin' ? 'user' : 'admin';
      const r = await fetch(`/admin/api/users/${user.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (r.ok) {
        await loadUsers();
      } else {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Failed to update role.');
      }
    });

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
      const r = await fetch(`/admin/api/users/${user.id}`, { method: 'DELETE' });
      if (r.ok) {
        await loadUsers();
        await loadStats();
      } else {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Failed to delete user.');
      }
    });

    actionsWrap.append(roleBtn, delBtn);
    tdActions.appendChild(actionsWrap);

    tr.append(tdUsername, tdEmail, tdRole, tdJoined, tdActions);
    tbody.appendChild(tr);
  });
}

// ── Categories ────────────────────────────────────────────────────────────────
async function loadAdminCategories() {
  const tbody = document.getElementById('categories-tbody');
  tbody.textContent = '';

  const res = await fetch('/admin/api/categories');
  if (!res.ok) return;
  const { categories } = await res.json();

  categories.forEach(cat => {
    const tr = document.createElement('tr');

    const tdIcon = document.createElement('td');
    tdIcon.textContent = cat.icon;
    tdIcon.style.fontSize = '1.4rem';

    const tdName = document.createElement('td');
    tdName.textContent  = cat.name;
    tdName.style.fontWeight = '600';

    const tdSlug = document.createElement('td');
    tdSlug.className   = 'text-muted text-sm';
    tdSlug.textContent = cat.slug;

    const tdDesc = document.createElement('td');
    tdDesc.className   = 'text-muted text-sm';
    tdDesc.textContent = cat.description;

    const tdActions = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete category "${cat.name}"? All threads inside will be deleted too.`)) return;
      const r = await fetch(`/admin/api/categories/${cat.id}`, { method: 'DELETE' });
      if (r.ok) {
        await loadAdminCategories();
        await loadStats();
      } else {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Failed to delete category.');
      }
    });
    tdActions.appendChild(delBtn);

    tr.append(tdIcon, tdName, tdSlug, tdDesc, tdActions);
    tbody.appendChild(tr);
  });
}

// Add category form
document.getElementById('add-category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('cat-form-error');
  errorEl.textContent = '';

  const name = document.getElementById('cat-name').value.trim();
  const slug = document.getElementById('cat-slug').value.trim();
  const icon = document.getElementById('cat-icon').value.trim() || '🎮';
  const desc = document.getElementById('cat-desc').value.trim();

  const res = await fetch('/admin/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, slug, icon, description: desc }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.error || 'Failed to add category.';
    return;
  }

  document.getElementById('add-category-form').reset();
  await loadAdminCategories();
  await loadStats();
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await loadUser();
  await Promise.all([loadStats(), loadUsers(), loadAdminCategories()]);
})();
