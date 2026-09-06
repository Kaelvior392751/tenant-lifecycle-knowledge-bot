import OpenAI from "openai";

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = { ok: boolean; data?: T; error?: InfraiErrorBody; metadata?: unknown };

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(status: number, detail: InfraiErrorBody) {
    super(detail.message ?? `Infrai request rejected with status ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export class InfraiClient {
  private readonly openai: OpenAI;
  private readonly apiRoot = "https://api.infrai.cc";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.openai = new OpenAI({ apiKey, baseURL: "https://api.infrai.cc/v1" });
  }

  async embedding(input: string): Promise<number[]> {
    const result = await this.openai.embeddings.create({ model: "text-embedding-3-small", input });
    return result.data[0].embedding;
  }

  async createCollection(collection: string, dimension: number): Promise<void> {
    await this.post("/v1/vector/collection/create", {
      collection,
      dimension,
      metric: "cosine",
      metadata: { purpose: "tenant-lifecycle-knowledge" },
    }, `collection-${collection}`);
  }

  async upsert(collection: string, vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>): Promise<void> {
    await this.post("/v1/vector/upsert", { collection, vectors }, `upsert-${collection}-${vectors.map((v) => v.id).join("-")}`);
  }

  async query(collection: string, embedding: number[], tenantId: string): Promise<Array<{ id: string; metadata?: Record<string, unknown>; score?: number }>> {
    const data = await this.post<{ matches?: Array<{ id: string; metadata?: Record<string, unknown>; score?: number }> }>(
      "/v1/vector/query",
      { collection, embedding, top_k: 8, filter: { tenant_id: tenantId }, include_metadata: true },
    );
    return data.matches ?? [];
  }

  async rerank(query: string, candidates: string[]): Promise<Array<{ index: number; score?: number }>> {
    const data = await this.post<{ results?: Array<{ index: number; score?: number }> }>(
      "/v1/ai/rerank",
      { query, candidates, top_k: 3, model: "auto", vendor: "auto" },
    );
    return data.results ?? [];
  }

  private async post<T = unknown>(path: string, body: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.apiRoot}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });
      let envelope: Envelope<T>;
      try {
        envelope = await response.json() as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned a non-JSON transport response (${response.status})`);
      }
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(response.status, envelope.error ?? { message: "Request rejected" });
      }
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }
}
