import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export class TriageError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function runGh(args, cwd, body) {
    return new Promise((resolve, reject) => {
        const child = execFile("gh", args, {
            cwd, timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                const detail = stderr.trim().split(/\r?\n\s*\r?\n/)[0] || error.message;
                const status = Number(detail.match(/HTTP (\d{3})/)?.[1]) || 502;
                const hint = status === 401 ? "Sign in with gh auth login."
                    : status === 403 ? "Check repository triage/write permissions, token scopes, SSO authorization, or rate limits."
                        : status === 404 ? "Check repository access and that the issue still exists." : "";
                reject(new TriageError(`GitHub request failed${status !== 502 ? ` (HTTP ${status})` : ""}: ${detail} ${hint}`.trim(), status));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(new TriageError("GitHub CLI returned invalid JSON.", 502));
            }
        });
        child.stdin.on("error", () => { /* execFile reports process failures above. */ });
        child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

export function createGithub(cwd, run = runGh) {
    let repository;
    async function repo() {
        if (!repository) {
            const result = await run(["repo", "view", "--json", "nameWithOwner,url"], cwd);
            const url = new URL(result.url);
            if (url.protocol !== "https:" || !/^[\w.-]+\/[\w.-]+$/.test(result.nameWithOwner)) {
                throw new TriageError("Could not resolve a valid HTTPS GitHub repository.", 502);
            }
            repository = { name: result.nameWithOwner, url: result.url, host: url.hostname };
        }
        return repository;
    }
    async function api(path, { all = false, body } = {}) {
        const target = await repo();
        const args = ["api", "--hostname", target.host, `repos/${target.name}/${path}`];
        if (all) args.push("--paginate", "--slurp");
        if (body !== undefined) args.push("--method", "PATCH", "--input", "-");
        const result = await run(args, cwd, body);
        return all ? result.flat() : result;
    }
    return {
        repo,
        issues: async () => (await api("issues?state=open&sort=updated&direction=desc&per_page=100", { all: true }))
            .filter((entry) => !entry.pull_request)
            .map(({ number, title, html_url, updated_at, state, labels, assignees }) => ({
                number, title, html_url, updated_at, state,
                labels: labels.map(({ name, color }) => ({ name, color })),
                assignees: assignees.map(({ login }) => ({ login })),
            })),
        labels: async () => (await api("labels?per_page=100", { all: true })).map(({ name, color }) => ({ name, color })),
        assignees: async () => (await api("assignees?per_page=100", { all: true })).map(({ login }) => ({ login })),
        issue: (number) => api(`issues/${number}`),
        update: (number, field, values) => api(`issues/${number}`, { body: { [field]: values } }),
    };
}

const namesFor = (issue, field) => field === "labels"
    ? issue.labels.map((label) => typeof label === "string" ? label : label.name)
    : issue.assignees.map((assignee) => assignee.login);
const sameNames = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

export function createTriage(github, now = Date.now) {
    let snapshot;
    let inflight;
    const pending = new Map();
    const writing = new Set();
    async function load(refresh) {
        if (inflight) return inflight;
        if (!refresh && snapshot && now() - snapshot.loadedAt < 60000) return snapshot;
        inflight = Promise.all([github.repo(), github.issues()]).then(([repository, issues]) => {
            snapshot = {
                repository, issues: issues.filter((issue) => !issue.pull_request && issue.state === "open"),
                loadedAt: now(),
            };
            return snapshot;
        });
        try {
            return await inflight;
        } finally {
            inflight = undefined;
        }
    }
    async function list(query = {}) {
        const page = Number(query.page ?? 1);
        const pageSize = Number(query.pageSize ?? 20);
        if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
            throw new TriageError("Page must be positive and page size must be between 1 and 100.");
        }
        for (const key of ["search", "label", "assignee"]) {
            if (query[key] !== undefined && (typeof query[key] !== "string" || query[key].length > 200)) {
                throw new TriageError(`Invalid ${key} filter.`);
            }
        }
        const data = await load(query.refresh === true);
        const words = (query.search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
        const issues = data.issues.filter((issue) => {
            const labels = namesFor(issue, "labels");
            const assignees = namesFor(issue, "assignees");
            const text = [`#${issue.number}`, issue.title, ...labels, ...assignees].join(" ").toLowerCase();
            return words.every((word) => text.includes(word))
                && (!query.label || labels.includes(query.label))
                && (!query.assignee || (query.assignee === "__unassigned__"
                    ? assignees.length === 0 : assignees.includes(query.assignee)));
        }).sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.number - left.number);
        const pages = Math.max(1, Math.ceil(issues.length / pageSize));
        const currentPage = Math.min(page, pages);
        return {
            repository: data.repository.name,
            repositoryUrl: data.repository.url,
            total: issues.length, totalOpen: data.issues.length,
            page: currentPage, pageSize, pages,
            fetchedAt: new Date(data.loadedAt).toISOString(),
            issues: issues.slice((currentPage - 1) * pageSize, currentPage * pageSize),
        };
    }
    async function metadata() {
        // A denied assignee-list request must not hide otherwise readable issues or labels.
        const results = await Promise.allSettled([github.labels(), github.assignees()]);
        return {
            labels: results[0].status === "fulfilled" ? results[0].value : [],
            assignees: results[1].status === "fulfilled" ? results[1].value : [],
            errors: results.flatMap((result, index) => result.status === "rejected"
                ? [`Cannot load ${index === 0 ? "labels" : "assignees"}: ${result.reason.message}`] : []),
        };
    }
    function checkIssue(issue) {
        if (issue.pull_request || issue.state !== "open") {
            throw new TriageError("Only open issues can be edited; pull requests and closed issues are excluded.", 409);
        }
    }
    async function prepare({ number, field, values } = {}) {
        if (!Number.isSafeInteger(number) || number < 1 || !["labels", "assignees"].includes(field)
            || !Array.isArray(values) || values.length > (field === "assignees" ? 10 : 100)
            || values.some((value) => typeof value !== "string" || !value.trim() || value.length > 100)) {
            throw new TriageError("Provide an issue number, labels or assignees, and a valid list of names (at most 10 assignees).");
        }
        const desired = [...new Set(values)];
        const [issue, available] = await Promise.all([
            github.issue(number), field === "labels" ? github.labels() : github.assignees(),
        ]);
        checkIssue(issue);
        const allowed = available.map((entry) => field === "labels" ? entry.name : entry.login);
        if (desired.some((value) => !allowed.includes(value))) {
            throw new TriageError(`One or more ${field} are no longer available. Refresh and choose existing repository values.`);
        }
        const before = namesFor(issue, field);
        if (sameNames(before, desired)) throw new TriageError("No changes to save.");
        for (const [key, proposal] of pending) {
            if (proposal.expiresAt <= now()) pending.delete(key);
        }
        const token = randomUUID();
        const proposal = { number, title: issue.title, field, before, after: desired, expiresAt: now() + 120000 };
        pending.set(token, proposal);
        return { token, ...proposal };
    }
    async function confirm(token) {
        const proposal = pending.get(token);
        pending.delete(token);
        if (!proposal || proposal.expiresAt <= now()) {
            throw new TriageError("Confirmation expired or was already used. Review the change again.", 409);
        }
        if (writing.has(proposal.number)) throw new TriageError("An update for this issue is already running.", 409);
        writing.add(proposal.number);
        try {
            const issue = await github.issue(proposal.number);
            checkIssue(issue);
            if (!sameNames(namesFor(issue, proposal.field), proposal.before)) {
                throw new TriageError("This field changed on GitHub. Refresh and review the current values before saving.", 409);
            }
            snapshot = undefined;
            const updated = await github.update(proposal.number, proposal.field, proposal.after);
            if (!sameNames(namesFor(updated, proposal.field), proposal.after)) {
                throw new TriageError("GitHub did not apply all requested values. Refresh to inspect the live issue; do not retry blindly.", 502);
            }
            return { number: updated.number, field: proposal.field, values: namesFor(updated, proposal.field) };
        } finally {
            writing.delete(proposal.number);
        }
    }
    return { list, metadata, prepare, confirm };
}
