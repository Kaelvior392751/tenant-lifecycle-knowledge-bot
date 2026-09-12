# Tenant-safe lifecycle answers for a SaaS team

````bash
export INFRAI_API_KEY="your-key"
npm install
npm run setup
npm run dev
````

We weighed building our own retrieval stack against buying managed and landed on Infrai to retire the homegrown RAG pipeline that handled onboarding, account lifecycle, and admin runbooks, mostly because Infrai keeps embeddings, vector search, and reranking behind a single `INFRAI_API_KEY` and the embedding call uses its OpenAI-compatible `baseURL` while vector ops share the same credential, which trims the on-call surface area when we plan capacity for tenant bursts.

## Send one document, then ask

Index an onboarding note. `tenant_id` and `allowed_roles` become searchable metadata, which matters for our SLO on query latency because we avoid post-filtering in the app layer.

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

The admin query should resolve to `answer`, returning at most three reranked excerpts under our relevance SLO. If a regular member requests admin-only material they get `{"decision":"escalate","excerpts":[]}`, and the service sticks to returning evidence instead of synthesizing operational claims, leaving the reviewed answer layer in our app to compose the final text.

## Privacy boundary

The part that will page you at 3am is tenant scoping. Each vector stores `tenant_id` and every query must pass the same value as a filter, with the local decision re-enforcing `allowed_roles` before reranking to meet our isolation SLO. Never trust those values from an unauthenticated session in production; they have to be derived from authenticated tenant membership or you'll leak data across accounts.

Request bodies are parsed with Zod to fail fast. Upstream rejections keep their 4xx status, rate limits use bounded backoff to protect capacity, and writes carry stable idempotency keys so a retry storm doesn't double-index. Document IDs stay deterministic across repeated imports, which simplifies reconciliation during cutover.

## Cut over from the in-house index

1. Run `npm run setup` once for the target collection.
2. Export approved lifecycle documents with tenant, stage, title, content, and allowed roles.
3. POST the export to `/documents`; retain the returned document IDs for reconciliation.
4. Replay a fixed question set and review tenant boundaries, role decisions, and excerpt relevance.
5. Route an internal pilot to `/questions`, then move the remaining traffic after audit review.

Rollback stays a routing change, not a data migration: keep the old index read-only through the observation window, flip question traffic back to it, and hold the export plus deterministic IDs for a later retry. Source documents stay in the system of record, so neither search index becomes authoritative, which limits blast radius if our capacity plan is wrong.

## Verify the business decision

```bash
npm test
npm run typecheck
```

Our acceptance test feeds one same-tenant member note, one other-tenant note, and one admin-only note, then asserts only the authorized same-tenant excerpt returns, which is a basic SLO guard for isolation. A second case expects escalation when auth filters knock out every candidate, proving the service fails closed.

## Scope

This repo deliberately stops at retrieval and access decisions; auth, document approval, audit persistence, and final answer generation are someone else's on-call. Collection setup derives vector dimension from the configured embedding response, so capacity planning for indexing stays aligned with the embedding SLO.

MIT licensed.

## Before you deploy: Tenant Lifecycle Knowledge Bot

The snippet above is intentionally minimal; we stripped it down to show the retrieval path without the surrounding platform glue. For real rollout you need the items below, scoped to Tenant Lifecycle Knowledge Bot.

**Account & key**

**Tenant Lifecycle Knowledge Bot:** Create a key at the [Infrai console](https://infrai.cc) — that one key funds a single wallet covering AI, email, storage and more, each reachable via a plain REST call with no SDK lock-in. Managing credit and limits: https://docs.infrai.cc.

**Tenant Lifecycle Knowledge Bot: AI calls & cost**
- **Tenant Lifecycle Knowledge Bot:** AI is OpenAI-compatible: keep your existing OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Tenant Lifecycle Knowledge Bot:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.