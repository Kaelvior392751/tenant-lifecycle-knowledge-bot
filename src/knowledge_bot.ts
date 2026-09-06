import { createHash } from "node:crypto";
import { z } from "zod";
import { InfraiClient } from "./infrai_client.js";

export const documentSchema = z.object({
  tenant_id: z.string().min(2),
  stage: z.enum(["onboarding", "active", "suspended", "closed"]),
  title: z.string().min(3),
  content: z.string().min(20),
  allowed_roles: z.array(z.enum(["member", "admin"])).min(1),
});

export const questionSchema = z.object({
  tenant_id: z.string().min(2),
  actor_role: z.enum(["member", "admin"]),
  question: z.string().min(5).max(500),
});

export type KnowledgeDocument = z.infer<typeof documentSchema>;
export type Question = z.infer<typeof questionSchema>;
type Match = { id: string; metadata?: Record<string, unknown>; score?: number };

export function decideAccess(question: Question, matches: Match[]): { decision: "answer" | "escalate"; candidates: string[] } {
  const candidates = matches.flatMap((match) => {
    const metadata = match.metadata;
    if (metadata?.tenant_id !== question.tenant_id) return [];
    const roles = metadata.allowed_roles;
    if (!Array.isArray(roles) || !roles.includes(question.actor_role)) return [];
    return typeof metadata.content === "string" ? [metadata.content] : [];
  });
  return { decision: candidates.length > 0 ? "answer" : "escalate", candidates };
}

export class KnowledgeBot {
  private readonly infrai: InfraiClient;
  private readonly collection: string;

  constructor(infrai: InfraiClient, collection: string) {
    this.infrai = infrai;
    this.collection = collection;
  }

  async index(document: KnowledgeDocument): Promise<{ document_id: string; state: "indexed" }> {
    const parsed = documentSchema.parse(document);
    const documentId = createHash("sha256")
      .update(`${parsed.tenant_id}:${parsed.stage}:${parsed.title}`)
      .digest("hex").slice(0, 24);
    const values = await this.infrai.embedding(`${parsed.title}\n${parsed.content}`);
    await this.infrai.upsert(this.collection, [{
      id: documentId,
      values,
      metadata: { ...parsed },
    }]);
    return { document_id: documentId, state: "indexed" };
  }

  async ask(input: Question): Promise<{ decision: "answer" | "escalate"; excerpts: string[] }> {
    const question = questionSchema.parse(input);
    const embedding = await this.infrai.embedding(question.question);
    const matches = await this.infrai.query(this.collection, embedding, question.tenant_id);
    const access = decideAccess(question, matches);
    if (access.decision === "escalate") return { decision: "escalate", excerpts: [] };
    const ranked = await this.infrai.rerank(question.question, access.candidates);
    const excerpts = ranked.flatMap((item) => access.candidates[item.index] ? [access.candidates[item.index]] : []);
    return { decision: "answer", excerpts };
  }
}
