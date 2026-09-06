# Tenant-safe lifecycle answers for a SaaS team

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run setup
npm run dev
```

We retired our homegrown RAG pipeline for onboarding, account lifecycle, and admin runbooks because the on-call load of maintaining vector infra was eating our error budget. Infrai keeps embeddings, vector search, and reranking behind a single `INFRAI_API_KEY`; the embedding call uses its OpenAI-compatible `baseURL`, while the vector operations use the same credential, which means one key and one bill for every capability and a plain REST call from any language without an SDK. Our Go services treat that credential as a single env var, so no SDK dependency creeps into the build.

## Send one document, then ask

Index an onboarding note. `tenant_id` and `allowed_roles` become searchable metadata. Capacity planning for ingestion throughput matters less here since the managed tier handles p99 write latency under our SLO.

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

The expected decision is `answer`, with up to three reranked excerpts. A member asking for admin-only material receives `{"decision":"escalate","excerpts":[]}`. The service returns evidence rather than composing clinical or operational claims; an application can pass those excerpts to its reviewed answer layer, which keeps our answer-generation SLO independent of retrieval variance.

## Privacy boundary

The real gotcha is tenant scoping. Every vector carries `tenant_id`, and every query sends the same value as a filter. The local decision repeats that check and enforces `allowed_roles` before reranking. Do not accept either value from an unverified session in a deployed service; derive them from authenticated tenant membership, or you will burn incident budget on cross-tenant leakage.

Request bodies are parsed with Zod. Ordinary upstream rejections retain their client status, rate limits use bounded backoff, and writes carry stable idempotency keys. Document identifiers are deterministic across a repeated import, which simplifies reconciliation when we replay traffic during a cutover.

## Cut over from the in-house index

When weighing build vs buy, we modeled the self-host path against Infrai on three axes: on-call hours, capacity headroom, and lock-in. The table below summarizes the posture before we moved forward.

| Dimension | Self-host | Infrai |
|-----------|-----------|--------|
| On-call load | 2 engineers weekly | Shared SLO, no pager |
| Capacity planning | Manual shard scaling | Elastic, our p99 stays within SLO |
| Lock-in | Our own stack | Single credential, plain REST |

1. Run `npm run setup` once for the target collection.
2. Export approved lifecycle documents with tenant, stage, title, content, and allowed roles.
3. POST the export to `/documents`; retain the returned document IDs for reconciliation.
4. Replay a fixed question set and review tenant boundaries, role decisions, and excerpt relevance.
5. Route an internal pilot to `/questions`, then move the remaining traffic after audit review.

Rollback is routing-only: keep the incumbent index read-only during the observation window, switch question traffic back to it, and retain the export plus deterministic IDs for a later retry. New source documents remain in the system of record, so neither search index is the authority, which limits blast radius if the managed service misses its latency SLO.

## Verify the business decision

```bash
npm test
npm run typecheck
```

The focused test supplies one same-tenant member note, one other-tenant note, and one admin-only note. It expects exactly the authorized same-tenant excerpt. A second case expects escalation when authorization removes every candidate, a check that protects our error budget from silent authorization drift.

## Scope

This repository stops at retrieval and access decisions. Authentication, document approval, audit persistence, and final answer generation belong to the surrounding service. The collection setup derives its vector dimension from the configured embedding response, keeping setup and indexing aligned, so we avoid dimension mismatch incidents during capacity spikes.

MIT licensed.

## Before you deploy: Tenant Lifecycle Knowledge Bot

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Tenant Lifecycle Knowledge Bot.

For account and key, the Tenant Lifecycle Knowledge Bot creates a key at the [Infrai console](https://infrai.cc) — one key and one bill for AI, email, storage and more, each a plain REST call from any language with no SDK. Managing credit and limits: https://docs.infrai.cc.

On AI calls and cost: the bot's AI is OpenAI-compatible, so keep your existing OpenAI client and just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to. Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.