const $ = (sel, root = document) => root.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
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
function showLogin(hint) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  if (hint) $("#login-hint").textContent = hint;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError($("#login-error"));
  try {
    await api("/api/auth/login", { method: "POST", body: { password: e.target.password.value } });
    e.target.reset();
    boot();
  } catch (err) {
    showError($("#login-error"), err.message);
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

/* ---------- Settings ---------- */
let settings = null;

function renderSettings() {
  const f = $("#settings-form");
  f.senderName.value = settings.senderName || "";
  f.senderBackground.value = settings.senderBackground || "";
  f.emailTemplate.value = settings.emailTemplate || "";
  f.spreadsheetId.value = settings.spreadsheetId || "";

  const connected = settings.googleConnected;
  $("#google-status").textContent = connected ? `Connected as ${settings.googleEmail}` : "Not connected.";
  $("#google-connect").textContent = connected ? "Reconnect" : "Connect Gmail & Sheets";
  $("#google-disconnect").hidden = !connected;

  const pill = $("#google-pill");
  pill.textContent = connected ? settings.googleEmail : "Google not connected";
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
        spreadsheetId: f.spreadsheetId.value,
      },
    });
    renderSettings();
    toast("Settings saved");
  } catch (err) {
    showError($("#settings-error"), err.message);
  }
});

$("#google-disconnect").addEventListener("click", async () => {
  await api("/api/auth/google/disconnect", { method: "POST" });
  settings = await api("/api/settings");
  renderSettings();
});

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
  $(".subject", node).value = contact.subject || "";
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
      body: { email: $(".to-email", node).value, subject: $(".subject", node).value, body: $(".body", node).value },
    });
  node.addEventListener("input", () => {
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
    if (!confirm(`Send this email to ${contact.name} <${to}>?`)) return;
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
        toast(`Sent to ${contact.name} and logged to your sheet`);
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
  btn.textContent = "Searching Apollo & ranking contacts…";
  const list = $("#drafts-list");
  list.innerHTML = `<div class="empty"><div class="envelope" aria-hidden="true"></div><p>Finding the best people at ${escapeHtml(f.company.value)}… this takes ~20 seconds.</p></div>`;
  try {
    const { contacts } = await api("/api/search", {
      method: "POST",
      body: { role: f.role.value, company: f.company.value, domain: f.domain.value },
    });
    list.innerHTML = "";
    const drafts = contacts.map((c, i) => renderDraft(c, i));
    drafts.forEach((d) => list.appendChild(d.node));
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

/* ---------- Log ---------- */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function loadLog() {
  try {
    const rows = await api("/api/outreach");
    const body = $("#log-body");
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="muted">Nothing yet. Sent emails show up here and in your Google Sheet.</td></tr>`;
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
          <td><span class="tag ${escapeHtml(r.status)}" title="${escapeHtml(r.error)}">${escapeHtml(r.status)}</span></td>
        </tr>`,
      )
      .join("");
  } catch {}
}
$("#refresh-log").addEventListener("click", loadLog);

async function refreshSettingsQuietly() {
  try {
    settings = await api("/api/settings");
    renderSettings();
  } catch {}
}

/* ---------- Boot ---------- */
async function boot() {
  const me = await api("/api/auth/me").catch(() => ({ authed: false, configured: false }));
  if (!me.authed) {
    return showLogin(me.configured ? "" : "Set an APP_PASSWORD environment variable on this site to enable sign-in.");
  }
  $("#login").hidden = true;
  $("#app").hidden = false;
  settings = await api("/api/settings");
  renderSettings();
  loadLog();

  const params = new URLSearchParams(location.search);
  if (params.get("google") === "connected") toast("Google account connected");
  if (params.get("google") === "error") {
    openSettings();
    toast(`Google connection failed: ${params.get("message") || "unknown error"}`);
  }
  if (params.has("google")) history.replaceState(null, "", "/");
  if (!settings.googleConnected && !params.has("google")) openSettings();
}

boot();
