/* global document, fetch, URL, window */
const element = (id) => document.getElementById(id);
let currentPage = 1;
let totalPages = 1;
let metadata = { labels: [], assignees: [] };
let editing;
let proposal;
let sequence = 0;
let busy = false;
let saving = false;
const csrfToken = window.location.pathname.split("/")[1];

function message(id, text = "") {
    element(id).textContent = text;
    element(id).hidden = !text;
}

async function request(path, body) {
    const response = await fetch(new URL(path, window.location.href), body === undefined ? {} : {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Triage-Token": csrfToken },
        body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
    return data;
}

function option(value, text) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = text;
    return node;
}

async function loadMetadata() {
    try {
        metadata = await request("metadata");
        for (const [id, entries, key] of [["label", metadata.labels, "name"], ["assignee", metadata.assignees, "login"]]) {
            const select = element(id);
            const selected = select.value;
            const defaults = id === "label" ? [option("", "All labels")]
                : [option("", "All assignees"), option("__unassigned__", "Unassigned")];
            const names = new Set(entries.map((entry) => entry[key]));
            if (selected) names.add(selected);
            select.replaceChildren(...defaults, ...[...names].filter((name) => name !== "__unassigned__")
                .sort((left, right) => left.localeCompare(right)).map((name) => option(name, name)));
            select.value = selected;
        }
        message("metadata-error", metadata.errors.join("\n"));
    } catch (error) {
        message("metadata-error", `Cannot load filter/edit options: ${error.message}`);
    }
}

function setBusy(value) {
    busy = value;
    element("issues").setAttribute("aria-busy", String(value));
    element("refresh").disabled = value || saving;
    element("previous").disabled = value || saving || currentPage <= 1;
    element("next").disabled = value || saving || currentPage >= totalPages;
    document.querySelectorAll(".issue-buttons button").forEach((button) => { button.disabled = value || saving; });
}

function renderIssue(issue) {
    const article = document.createElement("article");
    const heading = document.createElement("div");
    heading.className = "issue-heading";
    const link = document.createElement("a");
    const url = new URL(issue.html_url);
    if (url.protocol === "https:") link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `#${issue.number} ${issue.title}`;
    heading.append(link);
    const meta = document.createElement("p");
    meta.className = "issue-meta";
    const assignees = issue.assignees.map((assignee) => `@${assignee.login}`).join(", ") || "Unassigned";
    const date = document.createElement("time");
    date.dateTime = issue.updated_at;
    date.textContent = new Date(issue.updated_at).toLocaleString();
    meta.append(`${assignees} | Updated `, date);
    const labels = document.createElement("div");
    labels.className = "labels";
    for (const label of issue.labels) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = label.name;
        labels.append(badge);
    }
    if (!issue.labels.length) labels.textContent = "No labels";
    const buttons = document.createElement("div");
    buttons.className = "issue-buttons";
    for (const field of ["labels", "assignees"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Edit ${field}`;
        button.setAttribute("aria-label", `Edit ${field} for issue #${issue.number}`);
        button.addEventListener("click", () => openEditor(issue, field));
        buttons.append(button);
    }
    article.append(heading, meta, labels, buttons);
    return article;
}

async function loadIssues(refresh = false) {
    const requestId = ++sequence;
    setBusy(true);
    message("error");
    element("issues").replaceChildren();
    element("status").textContent = "Loading open issues...";
    const params = new URLSearchParams({
        search: element("search").value, label: element("label").value,
        assignee: element("assignee").value, page: String(currentPage),
        pageSize: element("page-size").value, refresh: String(refresh),
    });
    try {
        const data = await request(`issues?${params}`);
        if (requestId !== sequence) return;
        currentPage = data.page;
        totalPages = data.pages;
        element("repository").textContent = data.repository;
        element("repository").href = data.repositoryUrl;
        element("issues").replaceChildren(...data.issues.map(renderIssue));
        element("status").textContent = data.total
            ? `${data.total} matching of ${data.totalOpen} open issues | Fetched ${new Date(data.fetchedAt).toLocaleString()}`
            : data.totalOpen ? "No open issues match these filters." : "No open issues in this repository.";
        element("page").textContent = `Page ${currentPage} of ${totalPages}`;
    } catch (error) {
        if (requestId !== sequence) return;
        totalPages = 1;
        element("status").textContent = "Could not load open issues. Use Refresh to retry.";
        element("page").textContent = "Unavailable";
        message("error", error.message);
    } finally {
        if (requestId === sequence) setBusy(false);
    }
}

function openEditor(issue, field) {
    editing = { issue, field };
    proposal = undefined;
    message("edit-error");
    element("edit-title").textContent = `Edit ${field} for #${issue.number}`;
    element("edit-description").textContent = `${issue.title}. Uncheck all values to clear this field.`;
    const current = new Set(issue[field].map((entry) => field === "labels" ? entry.name : entry.login));
    const available = metadata[field].map((entry) => field === "labels" ? entry.name : entry.login);
    const names = [...new Set([...available, ...current])].sort((left, right) => left.localeCompare(right));
    const legend = document.createElement("legend");
    legend.textContent = field === "assignees" ? "Choose assignees (at most 10)" : "Choose labels";
    element("choices").replaceChildren(legend);
    for (const name of names) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = name;
        checkbox.checked = current.has(name);
        label.append(checkbox, document.createTextNode(name));
        element("choices").append(label);
    }
    if (!names.length) {
        const empty = document.createElement("p");
        empty.textContent = "No options available. Check the filter/edit option errors or Refresh.";
        element("choices").append(empty);
    }
    element("edit-dialog").showModal();
}

element("filters").addEventListener("submit", (event) => {
    event.preventDefault();
    currentPage = 1;
    message("notice");
    loadIssues();
});
element("refresh").addEventListener("click", () => { loadMetadata(); loadIssues(true); });
element("previous").addEventListener("click", () => { currentPage -= 1; loadIssues(); });
element("next").addEventListener("click", () => { currentPage += 1; loadIssues(); });
element("edit-cancel").addEventListener("click", () => element("edit-dialog").close());
element("confirm-cancel").addEventListener("click", () => { proposal = undefined; element("confirm-dialog").close(); });
element("confirm-dialog").addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
    else proposal = undefined;
});
element("edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    element("review").disabled = true;
    element("edit-cancel").disabled = true;
    message("edit-error");
    try {
        const values = [...element("choices").querySelectorAll("input:checked")].map((input) => input.value);
        proposal = await request("prepare", { number: editing.issue.number, field: editing.field, values });
        if (!element("edit-dialog").open) { proposal = undefined; return; }
        element("confirm-description").textContent = `#${proposal.number}: ${proposal.title} - replace ${proposal.field}`;
        element("before").textContent = proposal.before.join(", ") || "(none)";
        element("after").textContent = proposal.after.join(", ") || "(none)";
        element("edit-dialog").close();
        element("confirm-dialog").showModal();
    } catch (error) {
        message("edit-error", error.message);
    } finally {
        element("review").disabled = false;
        element("edit-cancel").disabled = false;
    }
});
element("confirm").addEventListener("click", async () => {
    if (!proposal || saving) return;
    const confirmed = proposal;
    proposal = undefined;
    saving = true;
    element("confirm").disabled = true;
    element("confirm-cancel").disabled = true;
    element("confirm").textContent = "Saving...";
    message("error");
    message("notice");
    try {
        await request("confirm", { token: confirmed.token });
        message("notice", `Updated ${confirmed.field} on issue #${confirmed.number}.`);
        await loadIssues(true);
    } catch (error) {
        message("error", `${error.message}\nThe update was not confirmed. Refresh to inspect live values before retrying.`);
    } finally {
        saving = false;
        element("confirm-dialog").close();
        element("confirm").disabled = false;
        element("confirm-cancel").disabled = false;
        element("confirm").textContent = "Confirm update";
        setBusy(busy);
    }
});

loadMetadata();
loadIssues();
