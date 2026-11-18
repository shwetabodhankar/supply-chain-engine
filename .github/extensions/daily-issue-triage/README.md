# Daily Issue Triage

Repository-scoped Copilot canvas (`daily-issue-triage`) for real open GitHub issues.
Reload extensions, then open **Daily Issue Triage**. Requires `gh` on PATH and an
authenticated local GitHub CLI account (`gh auth login`) with repository read
access. Edits require GitHub issue triage/write permissions and appropriate token
scopes/SSO authorization. No token is stored in this extension or sent to its UI.

The repository and GitHub hostname resolve from this checkout using `gh repo view`.
The canvas reads every REST API page, excludes pull requests, then searches and
paginates the complete open-issue list without GitHub Search's 1,000-result limit.
Literal, case-insensitive search matches all words across titles, issue numbers,
labels, and assignee logins (not issue bodies). Label and assignee filters combine
with search; Unassigned is supported. Filter selections take effect with **Apply
filters**. Issues show links, labels, assignees, and local-time last-updated dates.
**Refresh** reloads both issues and filter options. Issue reads are cached for up
to one minute; the fetched timestamp is displayed.

**Edit labels** or **Edit assignees** selects the complete replacement for that
field, including clearing it. **Review change** reads current values but does not
write. The confirmation dialog shows the current and proposed values; only
**Confirm update** writes one field on that issue. Cancel/Escape does not write.
Confirmations expire after two minutes and cannot be reused or shared across
panels. Current field values are checked again before saving to detect intervening
edits. GitHub does not provide an atomic compare-and-swap for this endpoint: a
concurrent edit in the brief check/update interval can still conflict. Failed or
ambiguous updates are never automatically retried; refresh before retrying.
Permission, authentication, rate-limit, and other errors are displayed explicitly.
An unavailable options endpoint does not hide readable issues.

GitHub is the durable source of truth. Panel filters and unconfirmed edits are
transient; reopening/reloading starts a fresh view. Servers bind only to loopback
on ephemeral ports, with per-panel random paths and same-origin/token checks on
POST requests. No extra dependencies or SDK installation are needed.

The agent-facing **list_issues** action is read-only. Optional input:

```json
{ "search": "bug", "label": "", "assignee": "__unassigned__", "page": 1, "pageSize": 20, "refresh": true }
```

Run focused, offline tests (fake GitHub transport; no live writes):

```powershell
node --test .github\extensions\daily-issue-triage\triage.test.mjs
```
