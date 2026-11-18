import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createGithub, createTriage } from "./github.mjs";
import { startServer } from "./server.mjs";

const cwd = fileURLToPath(new URL("../../../", import.meta.url));
const triage = createTriage(createGithub(cwd));
const servers = new Map();
const querySchema = {
    type: "object",
    properties: {
        search: { type: "string", maxLength: 200 },
        label: { type: "string", maxLength: 100 },
        assignee: { type: "string", maxLength: 100 },
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        refresh: { type: "boolean" },
    },
    additionalProperties: false,
};

await joinSession({
    canvases: [createCanvas({
        id: "daily-issue-triage",
        displayName: "Daily Issue Triage",
        description: "Browse real open GitHub issues and confirm label or assignee changes.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        actions: [{
            name: "list_issues",
            description: "Read open issues with pagination, literal search, and label/assignee filters; never writes.",
            inputSchema: querySchema,
            handler: async ({ input }) => {
                try {
                    return await triage.list(input ?? {});
                } catch (error) {
                    throw new CanvasError("github_read_failed", error.message);
                }
            },
        }],
        open: async ({ instanceId }) => {
            let entry = servers.get(instanceId);
            if (!entry) {
                entry = await startServer(triage);
                servers.set(instanceId, entry);
            }
            return { title: "Daily Issue Triage", url: entry.url };
        },
        onClose: async ({ instanceId }) => {
            const entry = servers.get(instanceId);
            if (entry) {
                servers.delete(instanceId);
                await entry.close();
            }
        },
    })],
});
