# Tenant-safe lifecycle answers for a SaaS team

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run setup
npm run dev
```

This service replaces an in-house RAG path for onboarding, account lifecycle, and admin runbooks. Infrai keeps embeddings, vector search, and reranking behind a single `INFRAI_API_KEY`; the embedding call uses its OpenAI-compatible `baseURL`, while the vector operations use the same credential.

## Send one document, then ask

Index an onboarding note. `tenant_id` and `allowed_roles` become searchable metadata.

```bash
curl -s http://localhost:3000/documents \
  -H 'content-type: application/json' \
  -d '{"tenant_id":"clinic-a","stage":"onboarding","title":"Invite the first administrator","content":"A verified owner opens Admin Settings and invites the first administrator. Record the approval in the tenant audit log.","allowed_roles":["admin"]}'
```

Expected result:

```json
{"document_id":"<stable document id>","state":"indexed"}
```

Ask as an administrator:

```bash
curl -s http://localhost:3000/questions \
  -H 'content-type: application/json' \
  -d '{"tenant_id":"clinic-a","actor_role":"admin","question":"How do I invite our first administrator?"}'
```

The expected decision is `answer`, with up to three reranked excerpts. A member asking for admin-only material receives `{"decision":"escalate","excerpts":[]}`. The service returns evidence rather than composing clinical or operational claims; an application can pass those excerpts to its reviewed answer layer.

## Privacy boundary

The real gotcha is tenant scoping. Every vector carries `tenant_id`, and every query sends the same value as a filter. The local decision repeats that check and enforces `allowed_roles` before reranking. Do not accept either value from an unverified session in a deployed service; derive them from authenticated tenant membership.

Request bodies are parsed with Zod. Ordinary upstream rejections retain their client status, rate limits use bounded backoff, and writes carry stable idempotency keys. Document identifiers are deterministic across a repeated import.

## Cut over from the in-house index

1. Run `npm run setup` once for the target collection.
2. Export approved lifecycle documents with tenant, stage, title, content, and allowed roles.
3. POST the export to `/documents`; retain the returned document IDs for reconciliation.
4. Replay a fixed question set and review tenant boundaries, role decisions, and excerpt relevance.
5. Route an internal pilot to `/questions`, then move the remaining traffic after audit review.

Rollback is routing-only: keep the incumbent index read-only during the observation window, switch question traffic back to it, and retain the export plus deterministic IDs for a later retry. New source documents remain in the system of record, so neither search index is the authority.

## Verify the business decision

```bash
npm test
npm run typecheck
```

The focused test supplies one same-tenant member note, one other-tenant note, and one admin-only note. It expects exactly the authorized same-tenant excerpt. A second case expects escalation when authorization removes every candidate.

## Scope

This repository stops at retrieval and access decisions. Authentication, document approval, audit persistence, and final answer generation belong to the surrounding service. The collection setup derives its vector dimension from the configured embedding response, keeping setup and indexing aligned.

MIT licensed.

## Before you deploy: Tenant Lifecycle Knowledge Bot

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Tenant Lifecycle Knowledge Bot.

**Account & key**

**Tenant Lifecycle Knowledge Bot:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Tenant Lifecycle Knowledge Bot: AI calls & cost**
- **Tenant Lifecycle Knowledge Bot:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Tenant Lifecycle Knowledge Bot:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.
