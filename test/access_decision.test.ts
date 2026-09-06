import assert from "node:assert/strict";
import test from "node:test";
import { decideAccess } from "../src/knowledge_bot.js";

test("member receives only same-tenant member guidance", () => {
  const result = decideAccess(
    { tenant_id: "clinic-a", actor_role: "member", question: "How is an account suspended?" },
    [
      { id: "a", metadata: { tenant_id: "clinic-a", allowed_roles: ["member", "admin"], content: "Members contact their tenant admin." } },
      { id: "b", metadata: { tenant_id: "clinic-b", allowed_roles: ["member"], content: "Private clinic B procedure." } },
      { id: "c", metadata: { tenant_id: "clinic-a", allowed_roles: ["admin"], content: "Admin-only suspension controls." } },
    ],
  );
  assert.deepEqual(result, { decision: "answer", candidates: ["Members contact their tenant admin."] });
});

test("request escalates when no authorized evidence remains", () => {
  const result = decideAccess(
    { tenant_id: "clinic-a", actor_role: "member", question: "How do I close this account?" },
    [{ id: "admin", metadata: { tenant_id: "clinic-a", allowed_roles: ["admin"], content: "Closure runbook." } }],
  );
  assert.deepEqual(result, { decision: "escalate", candidates: [] });
});
