// =====================================================================
// Reel Room — app.js
// All data lives in the signed-in user's own Google Drive:
//   /Reel Room Data/reel-room-data.json   (pages, ideas, prompts)
//   /Reel Room Data/media/<file>          (thumbnails & videos)
// The app only ever touches files it created (drive.file scope).
// =====================================================================

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

const state = {
  tokenClient: null,
  accessToken: null,
  folderId: null,
  mediaFolderId: null,
  dataFileId: null,
  data: { pages: [] },
  currentPageId: null,
  currentTab: "ideas",
  saveTimer: null,
  blobCache: new Map(),
};

// ---------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------
window.addEventListener("load", () => {
  if (!window.google || !google.accounts) {
    toast("Google sign-in script failed to load. Check your connection.", "error");
    return;
  }
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.DRIVE_SCOPE,
    callback: onTokenReceived,
  });

  document.getElementById("google-signin-btn").addEventListener("click", () => {
    state.tokenClient.requestAccessToken({ prompt: "consent" });
  });

  // Try a silent re-login if the browser remembers this Google session
  if (sessionStorage.getItem("rr_logged_in") === "1") {
    state.tokenClient.requestAccessToken({ prompt: "" });
  }
});

async function onTokenReceived(resp) {
  if (resp.error) {
    toast("Sign-in failed: " + resp.error, "error");
    return;
  }
  state.accessToken = resp.access_token;
  sessionStorage.setItem("rr_logged_in", "1");
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app").hidden = false;
  await fetchAccountInfo();
  await bootstrapDrive();
}

async function fetchAccountInfo() {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
    const info = await r.json();
    document.getElementById("account-name").textContent = info.name || info.email || "Signed in";
    if (info.picture) document.getElementById("account-avatar").src = info.picture;
  } catch (e) { /* non-critical */ }
}

document.getElementById("signout-btn").addEventListener("click", () => {
  if (state.accessToken) google.accounts.oauth2.revoke(state.accessToken, () => {});
  sessionStorage.removeItem("rr_logged_in");
  location.reload();
});

// ---------------------------------------------------------------
// DRIVE BOOTSTRAP
// ---------------------------------------------------------------
async function bootstrapDrive() {
  setDriveStatus("Connecting to Drive…");
  try {
    state.folderId = await findOrCreateFolder(CONFIG.APP_FOLDER_NAME, "root");
    state.mediaFolderId = await findOrCreateFolder("media", state.folderId);
    state.dataFileId = await findOrCreateDataFile();
    state.data = await loadData();
    if (!Array.isArray(state.data.pages)) state.data.pages = [];
    setDriveStatus("Synced ✓");
    renderPageList();
    renderCurrentView();
  } catch (e) {
    console.error(e);
    setDriveStatus("Drive connection failed", true);
    toast("Could not reach Google Drive. Try refreshing.", "error");
  }
}

function setDriveStatus(text, isError) {
  const el = document.getElementById("drive-status");
  el.textContent = text;
  el.classList.toggle("err", !!isError);
}

async function driveFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${state.accessToken}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return res;
}

async function findOrCreateFolder(name, parentId) {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  );
  const res = await driveFetch(`${DRIVE_FILES}?q=${q}&fields=files(id,name)`);
  const json = await res.json();
  if (json.files && json.files.length) return json.files[0].id;

  const createRes = await driveFetch(DRIVE_FILES, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const created = await createRes.json();
  return created.id;
}

async function findOrCreateDataFile() {
  const q = encodeURIComponent(
    `name='${CONFIG.DATA_FILE_NAME}' and '${state.folderId}' in parents and trashed=false`
  );
  const res = await driveFetch(`${DRIVE_FILES}?q=${q}&fields=files(id,name)`);
  const json = await res.json();
  if (json.files && json.files.length) return json.files[0].id;

  const metadata = { name: CONFIG.DATA_FILE_NAME, parents: [state.folderId], mimeType: "application/json" };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([JSON.stringify({ pages: [] })], { type: "application/json" }));
  const createRes = await driveFetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: "POST",
    body: form,
  });
  const created = await createRes.json();
  return created.id;
}

async function loadData() {
  const res = await driveFetch(`${DRIVE_FILES}/${state.dataFileId}?alt=media`);
  return await res.json();
}

function queueSave() {
  setDriveStatus("Saving…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveDataNow, 700);
}

async function saveDataNow() {
  try {
    await driveFetch(`${DRIVE_UPLOAD}/${state.dataFileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.data),
    });
    setDriveStatus("Synced ✓");
  } catch (e) {
    console.error(e);
    setDriveStatus("Save failed — retrying…", true);
    state.saveTimer = setTimeout(saveDataNow, 3000);
  }
}

async function uploadMedia(file) {
  const metadata = { name: `${Date.now()}_${file.name}`, parents: [state.mediaFolderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);
  const res = await driveFetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink,mimeType`, {
    method: "POST",
    body: form,
  });
  return await res.json(); // {id, webViewLink, mimeType}
}

async function deleteFile(fileId) {
  if (!fileId) return;
  try { await driveFetch(`${DRIVE_FILES}/${fileId}`, { method: "DELETE" }); } catch (e) { /* ignore */ }
}

async function getImageBlobUrl(fileId) {
  if (state.blobCache.has(fileId)) return state.blobCache.get(fileId);
  const res = await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  state.blobCache.set(fileId, url);
  return url;
}

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------
function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
}
function codePrefix(name) {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (letters.slice(0, 2) || "PG");
}
function currentPage() {
  return state.data.pages.find((p) => p.id === state.currentPageId) || null;
}
function toast(msg, type) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (type ? " " + type : "");
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 3200);
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------
// PAGE LIST / SIDEBAR
// ---------------------------------------------------------------
document.getElementById("add-page-btn").addEventListener("click", () => {
  const name = prompt("Name this Facebook page:");
  if (!name || !name.trim()) return;
  const page = {
    id: uid(),
    name: name.trim(),
    codePrefix: codePrefix(name.trim()),
    masterPrompt: "",
    ideaCounter: 0,
    ideas: [],
  };
  state.data.pages.push(page);
  state.currentPageId = page.id;
  queueSave();
  renderPageList();
  renderCurrentView();
});

function renderPageList() {
  const wrap = document.getElementById("page-list");
  wrap.innerHTML = "";
  state.data.pages.forEach((page) => {
    const div = document.createElement("div");
    div.className = "page-card" + (page.id === state.currentPageId ? " active" : "");
    const pending = page.ideas.filter((i) => !i.uploaded).length;
    div.innerHTML = `
      <div class="page-avatar">${escapeHtml(page.name.slice(0, 2).toUpperCase())}</div>
      <div class="page-card-info">
        <div class="page-card-name">${escapeHtml(page.name)}</div>
        <div class="page-card-meta">${pending} pending</div>
      </div>`;
    div.addEventListener("click", () => {
      state.currentPageId = page.id;
      renderPageList();
      renderCurrentView();
      document.getElementById("sidebar").classList.remove("open");
    });
    wrap.appendChild(div);
  });
}

document.getElementById("sidebar-toggle").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("open");
});

document.getElementById("rename-page-btn").addEventListener("click", () => {
  const page = currentPage();
  if (!page) return;
  const name = prompt("Rename page:", page.name);
  if (!name || !name.trim()) return;
  page.name = name.trim();
  queueSave();
  renderPageList();
  renderCurrentView();
});

document.getElementById("delete-page-btn").addEventListener("click", () => {
  const page = currentPage();
  if (!page) return;
  if (!confirm(`Delete "${page.name}" and all its ideas? This can't be undone.`)) return;
  state.data.pages = state.data.pages.filter((p) => p.id !== page.id);
  state.currentPageId = null;
  queueSave();
  renderPageList();
  renderCurrentView();
});

// ---------------------------------------------------------------
// TABS
// ---------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.currentTab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
    document.getElementById("tab-" + btn.dataset.tab).hidden = false;
    if (btn.dataset.tab === "uploaded") renderUploadedTable();
  });
});

// ---------------------------------------------------------------
// MAIN RENDER
// ---------------------------------------------------------------
function renderCurrentView() {
  const page = currentPage();
  document.getElementById("empty-state").hidden = !!page;
  document.getElementById("page-view").hidden = !page;
  if (!page) return;

  document.getElementById("page-title-display").textContent = page.name;
  document.getElementById("master-prompt-input").value = page.masterPrompt || "";
  renderIdeasTable();
  renderUploadedTable();
}

function renderIdeasTable() {
  const page = currentPage();
  const tbody = document.getElementById("ideas-tbody");
  tbody.innerHTML = "";
  const pending = page.ideas.filter((i) => !i.uploaded);
  document.getElementById("ideas-count").textContent = `${pending.length} idea${pending.length === 1 ? "" : "s"}`;
  document.getElementById("ideas-empty").hidden = pending.length > 0;

  pending.forEach((idea) => tbody.appendChild(buildIdeaRow(idea, page, false)));
}

function renderUploadedTable() {
  const page = currentPage();
  if (!page) return;
  const tbody = document.getElementById("uploaded-tbody");
  tbody.innerHTML = "";
  const done = page.ideas.filter((i) => i.uploaded);
  document.getElementById("uploaded-empty").hidden = done.length > 0;
  done.forEach((idea) => tbody.appendChild(buildIdeaRow(idea, page, true)));
}

function buildIdeaRow(idea, page, isUploadedView) {
  const tr = document.createElement("tr");
  if (idea.uploaded) tr.classList.add("done");

  const thumbCell = idea.thumbFileId
    ? `<img class="thumb-thumbnail" data-thumb-id="${idea.thumbFileId}" alt="thumbnail">`
    : `<div class="thumb-placeholder"></div>`;

  const videoCell = idea.videoFileId
    ? `<a class="video-link" href="${idea.videoLink || "#"}" target="_blank" rel="noopener">▶ Open</a>`
    : `<span class="video-none">—</span>`;

  tr.innerHTML = `
    <td><span class="idea-code">${page.codePrefix}-${String(idea.code).padStart(3, "0")}</span></td>
    <td class="idea-title">${escapeHtml(idea.title)}</td>
    <td class="idea-desc" title="${escapeHtml(idea.description)}">${escapeHtml(idea.description) || "—"}</td>
    <td class="idea-tags">${escapeHtml(idea.hashtags) || "—"}</td>
    <td class="idea-date">${idea.date || "—"}</td>
    <td>${thumbCell}</td>
    <td>${videoCell}</td>
    ${isUploadedView ? "" : `<td class="col-done"><input type="checkbox" class="check-toggle" ${idea.uploaded ? "checked" : ""}></td>`}
    <td class="row-actions">
      <button class="icon-btn edit-btn" title="Edit">✎</button>
      <button class="icon-btn danger del-btn" title="Delete">🗑</button>
    </td>`;

  const img = tr.querySelector("[data-thumb-id]");
  if (img) {
    getImageBlobUrl(idea.thumbFileId).then((url) => (img.src = url)).catch(() => {});
  }

  const checkbox = tr.querySelector(".check-toggle");
  if (checkbox) {
    checkbox.addEventListener("change", () => {
      idea.uploaded = checkbox.checked;
      idea.uploadedAt = checkbox.checked ? new Date().toISOString().slice(0, 10) : null;
      queueSave();
      renderIdeasTable();
      renderUploadedTable();
      renderPageList();
    });
  }

  tr.querySelector(".edit-btn").addEventListener("click", () => openIdeaModal(idea));
  tr.querySelector(".del-btn").addEventListener("click", async () => {
    if (!confirm(`Delete idea "${idea.title}"?`)) return;
    await deleteFile(idea.thumbFileId);
    await deleteFile(idea.videoFileId);
    page.ideas = page.ideas.filter((i) => i.id !== idea.id);
    queueSave();
    renderIdeasTable();
    renderUploadedTable();
    renderPageList();
  });

  return tr;
}

// ---------------------------------------------------------------
// MASTER PROMPT
// ---------------------------------------------------------------
document.getElementById("save-master-btn").addEventListener("click", () => {
  const page = currentPage();
  if (!page) return;
  page.masterPrompt = document.getElementById("master-prompt-input").value;
  queueSave();
  const tag = document.getElementById("master-saved-tag");
  tag.hidden = false;
  setTimeout(() => (tag.hidden = true), 2000);
});

// ---------------------------------------------------------------
// IDEA MODAL (add / edit)
// ---------------------------------------------------------------
let editingIdeaId = null;
let pendingThumbFile = null;
let pendingVideoFile = null;

document.getElementById("add-idea-btn").addEventListener("click", () => openIdeaModal(null));
document.getElementById("modal-cancel").addEventListener("click", closeIdeaModal);

function openIdeaModal(idea) {
  editingIdeaId = idea ? idea.id : null;
  pendingThumbFile = null;
  pendingVideoFile = null;
  document.getElementById("modal-title").textContent = idea ? "Edit idea" : "New idea";
  document.getElementById("f-title").value = idea ? idea.title : "";
  document.getElementById("f-desc").value = idea ? idea.description : "";
  document.getElementById("f-hashtags").value = idea ? idea.hashtags : "";
  document.getElementById("f-date").value = idea ? idea.date || "" : "";
  document.getElementById("f-thumb").value = "";
  document.getElementById("f-video").value = "";
  document.getElementById("upload-progress").hidden = true;

  const thumbPrev = document.getElementById("thumb-preview");
  const videoPrev = document.getElementById("video-preview");
  thumbPrev.hidden = true;
  videoPrev.hidden = true;
  if (idea && idea.thumbFileId) {
    getImageBlobUrl(idea.thumbFileId).then((url) => {
      thumbPrev.innerHTML = `<img src="${url}"><div class="file-name">Current thumbnail (choose a file to replace)</div>`;
      thumbPrev.hidden = false;
    });
  }
  if (idea && idea.videoFileId) {
    videoPrev.innerHTML = `<div class="file-name">Current video is saved (choose a file to replace)</div>`;
    videoPrev.hidden = false;
  }

  document.getElementById("idea-modal").hidden = false;
}

function closeIdeaModal() {
  document.getElementById("idea-modal").hidden = true;
  editingIdeaId = null;
}

document.getElementById("f-thumb").addEventListener("change", (e) => {
  pendingThumbFile = e.target.files[0] || null;
  const prev = document.getElementById("thumb-preview");
  if (!pendingThumbFile) { prev.hidden = true; return; }
  const reader = new FileReader();
  reader.onload = () => {
    prev.innerHTML = `<img src="${reader.result}"><div class="file-name">${escapeHtml(pendingThumbFile.name)}</div>`;
    prev.hidden = false;
  };
  reader.readAsDataURL(pendingThumbFile);
});

document.getElementById("f-video").addEventListener("change", (e) => {
  pendingVideoFile = e.target.files[0] || null;
  const prev = document.getElementById("video-preview");
  if (!pendingVideoFile) { prev.hidden = true; return; }
  const sizeMb = (pendingVideoFile.size / (1024 * 1024)).toFixed(1);
  prev.innerHTML = `<div class="file-name">${escapeHtml(pendingVideoFile.name)} (${sizeMb} MB)</div>`;
  prev.hidden = false;
});

document.getElementById("modal-save").addEventListener("click", async () => {
  const page = currentPage();
  if (!page) return;
  const title = document.getElementById("f-title").value.trim();
  if (!title) { toast("Give the idea a title first.", "error"); return; }

  const progress = document.getElementById("upload-progress");
  const saveBtn = document.getElementById("modal-save");
  saveBtn.disabled = true;

  try {
    let idea = editingIdeaId ? page.ideas.find((i) => i.id === editingIdeaId) : null;
    const isNew = !idea;
    if (isNew) {
      page.ideaCounter += 1;
      idea = { id: uid(), code: page.ideaCounter, uploaded: false, thumbFileId: null, videoFileId: null, videoLink: null };
      page.ideas.push(idea);
    }

    idea.title = title;
    idea.description = document.getElementById("f-desc").value.trim();
    idea.hashtags = document.getElementById("f-hashtags").value.trim();
    idea.date = document.getElementById("f-date").value;

    if (pendingThumbFile) {
      progress.hidden = false;
      progress.textContent = "Uploading thumbnail…";
      if (idea.thumbFileId) await deleteFile(idea.thumbFileId);
      const uploaded = await uploadMedia(pendingThumbFile);
      idea.thumbFileId = uploaded.id;
      state.blobCache.delete(uploaded.id);
    }
    if (pendingVideoFile) {
      progress.hidden = false;
      progress.textContent = "Uploading video…";
      if (idea.videoFileId) await deleteFile(idea.videoFileId);
      const uploaded = await uploadMedia(pendingVideoFile);
      idea.videoFileId = uploaded.id;
      idea.videoLink = uploaded.webViewLink;
    }

    queueSave();
    closeIdeaModal();
    renderIdeasTable();
    renderUploadedTable();
    renderPageList();
    toast("Idea saved.", "success");
  } catch (e) {
    console.error(e);
    toast("Something went wrong saving this idea.", "error");
  } finally {
    saveBtn.disabled = false;
    progress.hidden = true;
  }
});
