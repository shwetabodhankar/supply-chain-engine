import assert from "node:assert/strict";
import { test } from "node:test";
import { createGithub, createTriage, TriageError } from "./github.mjs";
import { startServer } from "./server.mjs";

function issue(number = 1, overrides = {}) {
    return {
        number, title: `Issue ${number}`, html_url: `https://github.com/example/repo/issues/${number}`,
        state: "open", updated_at: "2026-11-18T12:00:00Z",
        labels: [{ name: "bug", color: "ff0000" }], assignees: [{ login: "octocat" }],
        ...overrides,
    };
}

function fixture(issues = [issue()]) {
    let live = structuredClone(issues[0]);
    let clock = 0;
    const writes = [];
    const github = {
        repo: async () => ({ name: "example/repo", url: "https://github.com/example/repo" }),
        issues: async () => structuredClone(issues),
        labels: async () => [{ name: "bug" }, { name: "help wanted" }],
        assignees: async () => [{ login: "octocat" }, { login: "hubot" }],
        issue: async () => structuredClone(live),
        update: async (number, field, values) => {
            writes.push({ number, field, values });
            live[field] = values.map((value) => field === "labels" ? { name: value } : { login: value });
            return structuredClone(live);
        },
    };
    const triage = createTriage(github, () => clock);
    return { triage, github, writes, setLive: (value) => { live = value; }, tick: (ms) => { clock += ms; } };
}

test("reads every issue, excludes PRs/closed issues, and paginates beyond 1,000", async () => {
    const issues = Array.from({ length: 1250 }, (_, index) => issue(index + 1));
    issues.push(issue(2000, { pull_request: {} }), issue(2001, { state: "closed" }));
    const { triage } = fixture(issues);
    const page = await triage.list({ page: 13, pageSize: 100 });
    assert.equal(page.totalOpen, 1250);
    assert.equal(page.total, 1250);
    assert.equal(page.issues.length, 50);
    assert.equal(page.issues.at(-1).number, 1);
    assert.equal(page.pages, 13);
    const found = await triage.list({ search: "#1201 ISSUE", label: "bug", assignee: "octocat" });
    assert.deepEqual(found.issues.map((entry) => entry.number), [1201]);
});

test("combines literal filters, handles unassigned/empty results, and clamps pages", async () => {
    const { triage } = fixture([issue(), issue(2, { title: "<b>literal [bug]</b>", assignees: [] })]);
    assert.equal((await triage.list({ assignee: "__unassigned__" })).issues[0].number, 2);
    assert.equal((await triage.list({ search: "[BUG]" })).total, 1);
    assert.equal((await triage.list({ label: "unknown", page: 99 })).page, 1);
    assert.equal((await triage.list({ label: "unknown" })).total, 0);
    for (const query of [{ page: 0 }, { page: 1.5 }, { pageSize: 101 }, { search: {} }]) {
        await assert.rejects(triage.list(query), TriageError);
    }
});

test("Refresh bypasses the cache and a failed refresh reports an error instead of stale success", async () => {
    const { triage, github } = fixture();
    await triage.list();
    github.issues = async () => { throw new TriageError("Permission denied (HTTP 403)", 403); };
    assert.equal((await triage.list()).total, 1);
    await assert.rejects(triage.list({ refresh: true }), /Permission denied/);
});

test("metadata permission failures are explicit without losing other options or readable issues", async () => {
    const { triage, github } = fixture();
    github.assignees = async () => { throw new TriageError("Forbidden (HTTP 403)", 403); };
    const result = await triage.metadata();
    assert.equal(result.labels.length, 2);
    assert.deepEqual(result.assignees, []);
    assert.match(result.errors[0], /Cannot load assignees: Forbidden/);
    assert.equal((await triage.list()).total, 1);
});

test("prepare is read-only and confirmation replaces only the reviewed field once", async () => {
    const { triage, writes } = fixture();
    const proposal = await triage.prepare({ number: 1, field: "labels", values: ["help wanted"] });
    assert.deepEqual(proposal.before, ["bug"]);
    assert.deepEqual(proposal.after, ["help wanted"]);
    assert.deepEqual(writes, []);
    await triage.confirm(proposal.token);
    assert.deepEqual(writes, [{ number: 1, field: "labels", values: ["help wanted"] }]);
    await assert.rejects(triage.confirm(proposal.token), /expired or was already used/);
    assert.equal(writes.length, 1);
});

test("supports clearing assignees and rejects expired, stale, invalid, and PR changes without writes", async () => {
    const fixtureData = fixture();
    const { triage, writes, setLive, tick } = fixtureData;
    const cleared = await triage.prepare({ number: 1, field: "assignees", values: [] });
    await triage.confirm(cleared.token);
    assert.deepEqual(writes[0], { number: 1, field: "assignees", values: [] });
    const expired = await triage.prepare({ number: 1, field: "labels", values: [] });
    tick(120001);
    await assert.rejects(triage.confirm(expired.token), /expired/);
    const stale = await triage.prepare({ number: 1, field: "labels", values: [] });
    setLive(issue(1, { labels: [{ name: "help wanted" }] }));
    await assert.rejects(triage.confirm(stale.token), /field changed/);
    await assert.rejects(triage.prepare({ number: 1, field: "labels", values: ["does not exist"] }), /no longer available/);
    await assert.rejects(triage.prepare({ number: 1, field: "title", values: [] }), /valid list/);
    setLive(issue(1, { pull_request: {} }));
    await assert.rejects(triage.prepare({ number: 1, field: "labels", values: [] }), /Only open issues/);
    assert.equal(writes.length, 1);
});

test("write permission failures surface and consume confirmation; GitHub silent omissions are errors", async () => {
    const { triage, github } = fixture();
    const proposal = await triage.prepare({ number: 1, field: "assignees", values: ["hubot"] });
    github.update = async () => { throw new TriageError("Forbidden (HTTP 403)", 403); };
    await assert.rejects(triage.confirm(proposal.token), /Forbidden/);
    await assert.rejects(triage.confirm(proposal.token), /already used/);
    github.update = async () => issue();
    const omitted = await triage.prepare({ number: 1, field: "assignees", values: ["hubot"] });
    await assert.rejects(triage.confirm(omitted.token), /did not apply/);
});

test("CLI adapter paginates REST reads and sends only the selected field in a PATCH body", async () => {
    const calls = [];
    const github = createGithub(".", async (args, cwd, body) => {
        calls.push({ args, body });
        if (args[0] === "repo") return { nameWithOwner: "example/repo", url: "https://github.com/example/repo" };
        return args.includes("--paginate") ? [[issue()], [issue(2), issue(3, { pull_request: {} })]] : [];
    });
    const issues = await github.issues();
    assert.deepEqual(issues.map((entry) => entry.number), [1, 2]);
    assert.ok(calls[1].args.includes("--paginate"));
    assert.ok(calls[1].args.includes("--slurp"));
    assert.ok(!calls[1].args.includes("--jq"), "gh does not allow --jq with --slurp");
    await github.update(1, "assignees", []);
    assert.deepEqual(calls[2].body, { assignees: [] });
    assert.ok(calls[2].args.includes("PATCH"));
    assert.equal(calls[2].args.at(-1), "-");
});

test("loopback server serves reads, blocks unconfirmed/foreign writes, and binds confirmation to its panel", async (t) => {
    const { triage, writes } = fixture();
    const first = await startServer(triage);
    const second = await startServer(triage);
    t.after(() => Promise.all([first.close(), second.close()]));
    const url = new URL(first.url);
    const token = url.pathname.split("/")[1];
    const post = (base, route, body, origin = new URL(base).origin, csrf = new URL(base).pathname.split("/")[1]) =>
        fetch(`${base}${route}`, {
            method: "POST",
            headers: { Origin: origin, "X-Triage-Token": csrf, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    assert.equal(first.server.address().address, "127.0.0.1");
    const page = await fetch(first.url);
    assert.match(await page.text(), /Daily Issue Triage/);
    const read = await fetch(`${first.url}issues?page=1&pageSize=20`);
    assert.equal((await read.json()).total, 1);
    const invalid = await fetch(`${first.url}issues?page=0`);
    assert.equal(invalid.status, 400);
    assert.equal((await post(first.url, "confirm", { token: "invented" })).status, 409);
    assert.equal((await post(first.url, "prepare", {}, "https://evil.example", token)).status, 403);
    assert.equal((await post(first.url, "prepare", {}, url.origin, "incorrect")).status, 403);
    const prepare = await post(first.url, "prepare", { number: 1, field: "labels", values: [] });
    const proposal = await prepare.json();
    assert.ok(proposal.token);
    assert.equal(writes.length, 0);
    assert.equal((await post(second.url, "confirm", { token: proposal.token })).status, 409);
    assert.equal((await post(first.url, "confirm", { token: proposal.token })).status, 200);
    assert.equal(writes.length, 1);
    assert.equal((await post(first.url, "confirm", { token: proposal.token })).status, 409);
});
