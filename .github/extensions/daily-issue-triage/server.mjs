import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TriageError } from "./github.mjs";

async function readJson(req) {
    let body = "";
    for await (const chunk of req) {
        body += chunk;
        if (body.length > 32768) throw new TriageError("Request is too large.", 413);
    }
    try {
        return JSON.parse(body);
    } catch {
        throw new TriageError("Request must contain valid JSON.");
    }
}

export async function startServer(triage) {
    const [html, script, css] = await Promise.all([
        readFile(new URL("./index.html", import.meta.url), "utf8"),
        readFile(new URL("./app.js", import.meta.url), "utf8"),
        readFile(new URL("./style.css", import.meta.url), "utf8"),
    ]);
    const token = randomUUID();
    const base = `/${token}/`;
    const confirmations = new Set();
    let origin;
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
        function json(status, value) {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(value));
        }
        try {
            if (req.headers.host !== new URL(origin).host) throw new TriageError("Invalid host.", 403);
            const url = new URL(req.url, origin);
            if (!url.pathname.startsWith(base)) throw new TriageError("Not found.", 404);
            const route = url.pathname.slice(base.length);
            if (req.method === "GET") {
                const assets = {
                    "": [html, "text/html; charset=utf-8"],
                    "app.js": [script, "text/javascript; charset=utf-8"],
                    "style.css": [css, "text/css; charset=utf-8"],
                };
                if (Object.hasOwn(assets, route)) {
                    res.writeHead(200, { "Content-Type": assets[route][1] });
                    res.end(assets[route][0]);
                    return;
                }
                if (route === "issues") {
                    const query = Object.fromEntries(url.searchParams);
                    query.refresh = query.refresh === "true";
                    json(200, await triage.list(query));
                    return;
                }
                if (route === "metadata") {
                    json(200, await triage.metadata());
                    return;
                }
            }
            if (req.method === "POST") {
                if (req.headers.origin !== origin || req.headers["x-triage-token"] !== token) {
                    throw new TriageError("Request origin or confirmation token is invalid.", 403);
                }
                if (!req.headers["content-type"]?.startsWith("application/json")) {
                    throw new TriageError("Content-Type must be application/json.", 415);
                }
                const body = await readJson(req);
                if (route === "prepare") {
                    const proposal = await triage.prepare(body);
                    if (confirmations.size > 100) confirmations.clear();
                    confirmations.add(proposal.token);
                    json(200, proposal);
                    return;
                }
                if (route === "confirm") {
                    if (!confirmations.delete(body?.token)) {
                        throw new TriageError("Review and confirm this change in this panel first.", 409);
                    }
                    json(200, await triage.confirm(body.token));
                    return;
                }
            }
            throw new TriageError("Not found.", 404);
        } catch (error) {
            json(error instanceof TriageError ? error.status : 500, { error: error.message });
        }
    });
    server.requestTimeout = 15000;
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    return {
        server, url: `${origin}${base}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeIdleConnections();
        }),
    };
}
