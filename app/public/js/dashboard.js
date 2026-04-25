let allPosts   = { drafts: [], published: [] };
let categories = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
  await loadUser();
  await Promise.all([loadPosts(), loadCategories()]);
  bindEvents();
})();

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadUser() {
  const res      = await fetch('/api/me');
  const { user } = await res.json();
  document.getElementById('nav-username').textContent = user.username;
  if (user.role === 'admin') {
    document.getElementById('nav-admin-badge').style.display = 'inline';
    document.getElementById('nav-admin-link').style.display  = 'inline-flex';
  }
}

async function loadPosts() {
  try {
    const res  = await fetch('/api/dashboard/posts');
    const data = await res.json();
    allPosts   = data;
    renderPosts();
  } catch {
    setTableMessage('drafts-tbody',    4, 'Failed to load posts.');
    setTableMessage('published-tbody', 4, 'Failed to load posts.');
  }
}

async function loadCategories() {
  try {
    const res  = await fetch('/api/categories');
    const data = await res.json();
    categories = data.categories;
    populateCategorySelect();
  } catch {
    /* non-fatal — dropdown stays empty */
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderPosts() {
  document.getElementById('drafts-count').textContent    = allPosts.drafts.length;
  document.getElementById('published-count').textContent = allPosts.published.length;
  renderTable('drafts-tbody',    allPosts.drafts,    'draft');
  renderTable('published-tbody', allPosts.published, 'published');
}

function renderTable(tbodyId, posts, status) {
  const tbody = document.getElementById(tbodyId);
  tbody.textContent = ''; // clear safely

  if (!posts.length) {
    setTableMessage(tbodyId, 4, status === 'draft' ? 'No drafts yet.' : 'No published posts yet.');
    return;
  }

  posts.forEach(p => tbody.appendChild(createPostRow(p, status)));
}

function createPostRow(p, status) {
  const tr = document.createElement('tr');

  // Title
  const tdTitle = document.createElement('td');
  tdTitle.className = 'fw-bold';
  if (status === 'published') {
    const a = document.createElement('a');
    a.href = `/thread/${p.id}`;
    a.textContent = p.title;
    tdTitle.appendChild(a);
  } else {
    tdTitle.textContent = p.title;
  }
  tr.appendChild(tdTitle);

  // Category
  const tdCat = document.createElement('td');
  tdCat.className = 'text-muted';
  tdCat.textContent = p.category_name || '—';
  tr.appendChild(tdCat);

  // Date
  const tdDate = document.createElement('td');
  tdDate.className = 'text-muted text-sm';
  tdDate.textContent = new Date(p.updated_at).toLocaleDateString();
  tr.appendChild(tdDate);

  // Actions
  const tdAct = document.createElement('td');
  const div   = document.createElement('div');
  div.className = 'row-actions';

  const editBtn = makeBtn('Edit', 'btn btn-ghost btn-sm', () => openEditModal(p.id));

  const nextStatus  = status === 'draft' ? 'published' : 'draft';
  const toggleLabel = status === 'draft' ? 'Publish' : 'Unpublish';
  const toggleExtra = status === 'draft' ? 'btn-action-publish' : 'btn-action-unpublish';
  const toggleBtn   = makeBtn(toggleLabel, `btn btn-ghost btn-sm ${toggleExtra}`, () => toggleStatus(p.id, nextStatus));

  const delBtn = makeBtn('Delete', 'btn btn-danger btn-sm', () => deletePost(p.id));

  div.append(editBtn, toggleBtn, delBtn);
  tdAct.appendChild(div);
  tr.appendChild(tdAct);

  return tr;
}

function makeBtn(label, className, onClick) {
  const btn     = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function setTableMessage(tbodyId, cols, message) {
  const tbody = document.getElementById(tbodyId);
  tbody.textContent = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan  = cols;
  td.className = 'text-muted';
  td.style.textAlign = 'center';
  td.style.padding   = '2rem';
  td.textContent = message;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

function populateCategorySelect() {
  const sel = document.getElementById('post-category');
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openCreateModal() {
  document.getElementById('modal-title').textContent = 'New Post';
  document.getElementById('edit-post-id').value      = '';
  document.getElementById('post-title').value        = '';
  document.getElementById('post-category').value     = '';
  document.getElementById('post-body').value         = '';
  clearFormError();
  openModal();
}

function openEditModal(postId) {
  const post = [...allPosts.drafts, ...allPosts.published].find(p => p.id === postId);
  if (!post) return;

  document.getElementById('modal-title').textContent  = 'Edit Post';
  document.getElementById('edit-post-id').value       = post.id;
  document.getElementById('post-title').value         = post.title;
  document.getElementById('post-category').value      = post.category_id || '';
  document.getElementById('post-body').value          = post.body || '';
  clearFormError();
  openModal();
}

function openModal()  { document.getElementById('modal-overlay').classList.add('open'); }
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

function clearFormError() {
  const errEl = document.getElementById('post-form-error');
  errEl.textContent = '';
  errEl.className   = '';
}

function setFormError(message) {
  const errEl = document.getElementById('post-form-error');
  errEl.textContent = message;
  errEl.className   = 'alert alert-error';
}

// ── Post actions ──────────────────────────────────────────────────────────────

async function savePost(status) {
  const postId     = document.getElementById('edit-post-id').value;
  const title      = document.getElementById('post-title').value.trim();
  const categoryId = document.getElementById('post-category').value;
  const body       = document.getElementById('post-body').value.trim();

  if (!title || !body || !categoryId) {
    setFormError('Title, category and body are required.');
    return;
  }
  clearFormError();

  try {
    if (postId) {
      const res = await fetch(`/api/posts/${postId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title, body, categoryId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save.');

      // Sync status if it changed
      const post = [...allPosts.drafts, ...allPosts.published].find(p => p.id === postId);
      if (post && post.status !== status) {
        const sr = await fetch(`/api/posts/${postId}/status`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ status }),
        });
        if (!sr.ok) throw new Error((await sr.json()).error || 'Failed to update status.');
      }
    } else {
      const res = await fetch('/api/posts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title, content: body, categoryId, draft: status === 'draft' }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create post.');
    }

    closeModal();
    await loadPosts();
  } catch (err) {
    setFormError(err.message);
  }
}

async function toggleStatus(postId, newStatus) {
  try {
    const res = await fetch(`/api/posts/${postId}/status`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to update status.');
    await loadPosts();
  } catch (err) {
    alert(err.message);
  }
}

async function deletePost(postId) {
  if (!confirm('Delete this post and all its comments? This cannot be undone.')) return;
  try {
    const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete post.');
    await loadPosts();
  } catch (err) {
    alert(err.message);
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('new-post-btn').addEventListener('click', openCreateModal);
  document.getElementById('modal-close').addEventListener('click',  closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('save-draft-btn').addEventListener('click', () => savePost('draft'));
  document.getElementById('publish-btn').addEventListener('click',    () => savePost('published'));

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b   => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}
