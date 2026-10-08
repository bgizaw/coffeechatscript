const $ = (sel, root = document) => root.querySelector(sel);

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(path, {
    ...opts,
    headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) },
    body: opts.body && !isForm && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/auth")) showLogin();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

function showError(el, msg) {
  el.textContent = msg || "";
  el.hidden = !msg;
}

/* ---------- Auth ---------- */
function showLogin(error) {
  closeSettings();
  $("#app").hidden = true;
  $("#login").hidden = false;
  showError($("#login-error"), error);
}

async function signOut() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  settings = null;
  resumes = [];
  resetDrafts();
  showLogin();
}
$("#logout").addEventListener("click", signOut);
$("#logout-2").addEventListener("click", signOut);

$("#delete-account").addEventListener("click", async () => {
  if (!confirm("Permanently delete your AutoCoffeeChat account, resumes, drafts, and history? This can't be undone.")) return;
  try {
    await api("/api/auth/account", { method: "DELETE" });
    settings = null;
    resumes = [];
    resetDrafts();
    showLogin();
    toast("Your account was deleted");
  } catch (err) {
    toast(err.message);
  }
});

/* ---------- Settings ---------- */
let settings = null;

function renderSettings() {
  const f = $("#settings-form");
  f.senderName.value = settings.senderName || "";
  f.senderBackground.value = settings.senderBackground || "";
  f.emailTemplate.value = settings.emailTemplate || "";
  f.contactPriorities.value = settings.contactPriorities || "";
  f.spreadsheetId.value = settings.spreadsheetId || "";

  const connected = settings.googleConnected;
  $("#account-name").textContent = settings.name || settings.senderName || settings.email;
  $("#account-email").textContent = settings.email;
  const avatar = $("#account-avatar");
  avatar.hidden = !settings.picture;
  if (settings.picture) avatar.src = settings.picture;
  $("#google-warning").hidden = connected;
  $("#switch-account").textContent = connected ? "Use a different Google account" : "Reconnect Google";
  $("#switch-account").href = connected ? "/api/auth/google/start" : `/api/auth/google/start?consent=1&hint=${encodeURIComponent(settings.email)}`;

  const pill = $("#google-pill");
  pill.textContent = connected ? settings.email : `${settings.email} · reconnect needed`;
  pill.classList.toggle("on", connected);

  const sheet = $("#sheet-link");
  sheet.hidden = !settings.spreadsheetId;
  if (settings.spreadsheetId) sheet.href = `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`;
}

function openSettings() {
  $("#settings").classList.add("open");
  $("#settings").setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
}
function closeSettings() {
  $("#settings").classList.remove("open");
  $("#settings").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}
$("#open-settings").addEventListener("click", openSettings);
$("#close-settings").addEventListener("click", closeSettings);
$("#scrim").addEventListener("click", closeSettings);
document.addEventListener("keydown", (e) => e.key === "Escape" && closeSettings());

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  showError($("#settings-error"));
  try {
    settings = await api("/api/settings", {
      method: "PUT",
      body: {
        senderName: f.senderName.value,
        senderBackground: f.senderBackground.value,
        emailTemplate: f.emailTemplate.value,
        contactPriorities: f.contactPriorities.value,
        spreadsheetId: f.spreadsheetId.value,
      },
    });
    renderSettings();
    toast("Settings saved");
  } catch (err) {
    showError($("#settings-error"), err.message);
  }
});

/* ---------- Resumes ---------- */
let resumes = [];

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function renderResumes() {
  const list = $("#resume-list");
  list.innerHTML = resumes
    .map((r) => {
      const isDefault = settings?.defaultResumeId === r.id;
      const ext = (r.filename.split(".").pop() || "").toUpperCase();
      return `<li class="resume${isDefault ? " default" : ""}" data-id="${r.id}">
        <span class="resume-icon" aria-hidden="true">${escapeHtml(ext)}</span>
        <div class="resume-meta">
          <p class="resume-label">${escapeHtml(r.label)}</p>
          <p class="resume-file"><a href="/api/resumes/${r.id}" target="_blank" rel="noopener">${escapeHtml(r.filename)}</a> · ${formatSize(r.size)}</p>
        </div>
        <div class="resume-actions">
          <button class="icon-btn star" type="button" data-act="default" aria-pressed="${isDefault}" title="${isDefault ? "Attached by default — click to stop" : "Attach by default on new drafts"}">${isDefault ? "★" : "☆"}</button>
          <button class="icon-btn" type="button" data-act="rename">Rename</button>
          <button class="icon-btn" type="button" data-act="delete">Delete</button>
        </div>
      </li>`;
    })
    .join("");
  // Keep every draft's picker in sync with the current list.
  document.querySelectorAll("#drafts-list .letter").forEach((node) => fillResumeSelect(node, $(".resume-select", node).value));
}

async function loadResumes() {
  try {
    resumes = await api("/api/resumes");
    renderResumes();
  } catch {}
}

$("#resume-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = Number(btn.closest(".resume").dataset.id);
  const resume = resumes.find((r) => r.id === id);
  showError($("#resume-error"));
  try {
    if (btn.dataset.act === "default") {
      const next = settings.defaultResumeId === id ? null : id;
      settings = await api("/api/settings", { method: "PUT", body: { defaultResumeId: next } });
      renderResumes();
      toast(next ? `"${resume.label}" will be attached to new drafts` : "New drafts won't attach a resume by default");
    }
    if (btn.dataset.act === "rename") {
      const label = prompt("Name this resume", resume.label);
      if (!label || label.trim() === resume.label) return;
      const updated = await api(`/api/resumes/${id}`, { method: "PUT", body: { label } });
      resumes = resumes.map((r) => (r.id === id ? updated : r));
      renderResumes();
    }
    if (btn.dataset.act === "delete") {
      if (!confirm(`Delete "${resume.label}"? Drafts using it will be set to no resume.`)) return;
      await api(`/api/resumes/${id}`, { method: "DELETE" });
      resumes = resumes.filter((r) => r.id !== id);
      if (settings.defaultResumeId === id) settings.defaultResumeId = null;
      renderResumes();
    }
  } catch (err) {
    showError($("#resume-error"), err.message);
  }
});

const fileDrop = $(".file-drop");
const fileInput = $("#resume-form input[type=file]");
const fileText = $(".file-drop-text");
const fileTextDefault = fileText.innerHTML;
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileDrop.classList.toggle("chosen", Boolean(file));
  if (file) fileText.textContent = `${file.name} · ${formatSize(file.size)}`;
  else fileText.innerHTML = fileTextDefault;
});
["dragenter", "dragover"].forEach((t) => fileDrop.addEventListener(t, () => fileDrop.classList.add("drag")));
["dragleave", "drop"].forEach((t) => fileDrop.addEventListener(t, () => fileDrop.classList.remove("drag")));

$("#resume-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const file = fileInput.files[0];
  showError($("#resume-error"));
  if (!file) return showError($("#resume-error"), "Choose a file to upload.");
  if (file.size > 4 * 1024 * 1024) return showError($("#resume-error"), "Resumes must be 4 MB or smaller.");
  const btn = $("#resume-upload-btn");
  btn.disabled = true;
  btn.textContent = "Uploading…";
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("label", f.label.value);
    const created = await api("/api/resumes", { method: "POST", body: form });
    resumes.push(created);
    if (resumes.length === 1) settings.defaultResumeId = created.id;
    f.reset();
    fileInput.dispatchEvent(new Event("change"));
    renderResumes();
    toast(`Uploaded "${created.label}"`);
  } catch (err) {
    showError($("#resume-error"), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Upload resume";
  }
});

function fillResumeSelect(node, selectedId) {
  const select = $(".resume-select", node);
  const selected = String(selectedId ?? "");
  select.innerHTML =
    `<option value="">No resume</option>` +
    resumes.map((r) => `<option value="${r.id}">📎 ${escapeHtml(r.label)} (${escapeHtml(r.filename)})</option>`).join("");
  select.value = resumes.some((r) => String(r.id) === selected) ? selected : "";
  if (!resumes.length) select.innerHTML = `<option value="">No resume — upload one in Settings</option>`;
  $(".attach-line", node).classList.toggle("has-resume", Boolean(select.value));
}

/* ---------- Drafts ---------- */
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function renderDraft(contact, index) {
  const node = $("#draft-template").content.firstElementChild.cloneNode(true);
  node.dataset.id = contact.id;
  $(".to-name", node).textContent = contact.name;
  $(".to-title", node).textContent = [contact.title, contact.company].filter(Boolean).join(" · ");
  $(".rank", node).textContent = `Pick #${index + 1}`;
  $(".reason", node).textContent = contact.reason || "";
  $(".to-email", node).value = contact.email || "";
  const note = $(".pattern-note", node);
  note.textContent = contact.emailPattern ? `Predicted email · pattern ${contact.emailPattern}` : "";
  note.hidden = !contact.emailPattern;
  $(".subject", node).value = contact.subject || "";
  fillResumeSelect(node, contact.resumeId);
  $(".body", node).value = contact.body || "";
  if (contact.linkedinUrl) {
    const a = $(".linkedin", node);
    a.href = contact.linkedinUrl;
    a.hidden = false;
  }
  if (contact.status === "sent") node.classList.add("sent");

  const err = $(".letter-error", node);
  const setBusy = (busy) => node.querySelectorAll("button").forEach((b) => (b.disabled = busy));

  // Persist edits shortly after typing stops.
  let saveTimer;
  const save = () =>
    api(`/api/outreach/${contact.id}`, {
      method: "PUT",
      body: {
        email: $(".to-email", node).value,
        subject: $(".subject", node).value,
        body: $(".body", node).value,
        resumeId: $(".resume-select", node).value ? Number($(".resume-select", node).value) : null,
      },
    });
  $(".resume-select", node).addEventListener("change", () => {
    $(".attach-line", node).classList.toggle("has-resume", Boolean($(".resume-select", node).value));
    save().catch((e) => showError(err, e.message));
  });
  node.addEventListener("input", (e) => {
    if (e.target.classList.contains("resume-select")) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save().catch((e) => showError(err, e.message)), 600);
  });

  const generate = async () => {
    node.classList.add("loading");
    setBusy(true);
    showError(err);
    try {
      const updated = await api(`/api/outreach/${contact.id}/draft`, { method: "POST" });
      $(".subject", node).value = updated.subject;
      $(".body", node).value = updated.body;
    } catch (e) {
      showError(err, e.message);
    } finally {
      node.classList.remove("loading");
      setBusy(false);
    }
  };
  $(".regen", node).addEventListener("click", generate);

  $(".discard", node).addEventListener("click", async () => {
    await api(`/api/outreach/${contact.id}`, { method: "DELETE" }).catch(() => {});
    node.remove();
    if (!$("#drafts-list .letter")) resetDrafts();
  });

  $(".send", node).addEventListener("click", async () => {
    const to = $(".to-email", node).value.trim();
    const select = $(".resume-select", node);
    const attached = select.value ? resumes.find((r) => String(r.id) === select.value) : null;
    const attachNote = attached ? `\n\nAttaching: ${attached.filename}` : "\n\nNo resume attached.";
    if (!confirm(`Send this email to ${contact.name} <${to}>?${attachNote}`)) return;
    clearTimeout(saveTimer);
    setBusy(true);
    showError(err);
    try {
      await save();
      const result = await api(`/api/outreach/${contact.id}/send`, { method: "POST", body: { timeZone } });
      node.classList.add("sent");
      if (result.sheetError) {
        showError(err, `Sent, but couldn't log to Google Sheets: ${result.sheetError}`);
      } else {
        toast(`Sent to ${contact.name}${attached ? ` with ${attached.label}` : ""} and logged to your sheet`);
      }
      refreshSettingsQuietly();
      loadLog();
    } catch (e) {
      showError(err, e.message);
      setBusy(false);
    }
  });

  return { node, generate };
}

function resetDrafts() {
  $("#drafts-list").innerHTML = `<div class="empty"><div class="envelope" aria-hidden="true"></div><p>Drafts land here. Enter a role and company to start.</p></div>`;
}

$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $("#search-btn");
  showError($("#search-error"));
  if (!settings?.senderName || !settings?.emailTemplate) {
    toast("Tip: add your name, background, and template in Settings for better drafts");
  }
  btn.disabled = true;
  btn.textContent = "Searching the web & ranking contacts…";
  const list = $("#drafts-list");
  const setStatus = (text) =>
    (list.innerHTML = `<div class="empty"><div class="envelope" aria-hidden="true"></div><p>${escapeHtml(text)}</p><p class="hint">Web research usually takes 1–3 minutes.</p></div>`);
  setStatus(`Finding the best people at ${f.company.value}…`);
  try {
    const { search } = await api("/api/search", {
      method: "POST",
      body: { role: f.role.value, company: f.company.value, domain: f.domain.value },
    });
    const contacts = await waitForSearch(search.id, setStatus);
    list.innerHTML = "";
    const drafts = contacts.map((c, i) => renderDraft(c, i));
    drafts.forEach((d) => list.appendChild(d.node));
    loadPatterns();
    await Promise.all(drafts.map((d) => d.generate()));
    loadLog();
  } catch (err) {
    resetDrafts();
    showError($("#search-error"), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Find the top 2 people";
  }
});

async function waitForSearch(id, onProgress) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const { search, contacts } = await api(`/api/search/${id}`);
    if (search.status === "done") return contacts;
    if (search.status === "failed") throw new Error(search.error || "Search failed.");
    if (search.progress) onProgress(search.progress);
  }
  throw new Error("The search is taking too long. Try again in a minute.");
}

/* ---------- Log ---------- */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function loadLog() {
  try {
    const rows = await api("/api/outreach");
    const body = $("#log-body");
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="8" class="muted">Nothing yet. Sent emails show up here and in your Google Sheet.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(
        (r) => `<tr>
          <td class="mono">${r.sentAt ? new Date(r.sentAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.company)}</td>
          <td class="mono">${escapeHtml(r.email)}</td>
          <td>${escapeHtml(r.role)}</td>
          <td class="mono">${r.attachedResume ? `📎 ${escapeHtml(r.attachedResume)}` : `<span class="muted">—</span>`}</td>
          <td><span class="tag ${escapeHtml(r.status)}" title="${escapeHtml(r.error)}">${escapeHtml(r.status)}</span></td>
        </tr>`,
      )
      .join("");
  } catch {}
}
$("#refresh-log").addEventListener("click", loadLog);

/* ---------- Email patterns ---------- */
async function loadPatterns() {
  try {
    const rows = await api("/api/patterns");
    const body = $("#patterns-body");
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="5" class="muted">Nothing yet. Each company's email format is saved here after a search.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map((r) => {
        const examples = (r.examples || [])
          .map((e) => (e.sourceUrl ? `<a class="link" href="${escapeHtml(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.email)}</a>` : escapeHtml(e.email)))
          .join("<br />");
        return `<tr>
          <td class="mono">${escapeHtml(r.domain)}</td>
          <td class="mono">${r.pattern ? `${escapeHtml(r.pattern)}<br /><span class="muted">${escapeHtml(r.example)}</span>` : `<span class="muted">not found</span>`}</td>
          <td class="mono">${examples || `<span class="muted">none</span>`}</td>
          <td class="mono">${r.checkedAt ? new Date(r.checkedAt).toLocaleDateString([], { dateStyle: "medium" }) : "—"}</td>
          <td><button class="btn btn-ghost forget" type="button" data-domain="${escapeHtml(r.domain)}">Forget</button></td>
        </tr>`;
      })
      .join("");
  } catch {}
}
$("#refresh-patterns").addEventListener("click", loadPatterns);
$("#patterns-body").addEventListener("click", async (e) => {
  const btn = e.target.closest(".forget");
  if (!btn) return;
  await api(`/api/patterns/${encodeURIComponent(btn.dataset.domain)}`, { method: "DELETE" }).catch(() => {});
  loadPatterns();
});

async function refreshSettingsQuietly() {
  try {
    settings = await api("/api/settings");
    renderSettings();
  } catch {}
}

/* ---------- Boot ---------- */
async function boot() {
  const params = new URLSearchParams(location.search);
  const status = params.get("google");
  const message = params.get("message");
  if (params.has("google")) history.replaceState(null, "", "/");

  const me = await api("/api/auth/me").catch(() => ({ authed: false }));
  if (!me.authed) return showLogin(status === "error" ? message || "Sign-in failed." : "");

  $("#login").hidden = true;
  $("#app").hidden = false;
  [settings, resumes] = await Promise.all([api("/api/settings"), api("/api/resumes").catch(() => [])]);
  renderSettings();
  renderResumes();
  loadLog();
  loadPatterns();

  if (status === "connected") toast(`Signed in as ${settings.email}`);
  if (status === "error") toast(`Google sign-in failed: ${message || "unknown error"}`);
  // First visit: help the user set up their profile, template, and resume.
  if (!settings.senderBackground && !settings.emailTemplate && !resumes.length) openSettings();
}

boot();
