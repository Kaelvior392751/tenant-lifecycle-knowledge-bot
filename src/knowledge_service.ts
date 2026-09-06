import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { documentSchema, KnowledgeBot, questionSchema } from "./knowledge_bot.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const bot = new KnowledgeBot(new InfraiClient(apiKey), process.env.KB_COLLECTION ?? "tenant-lifecycle-docs");

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  try {
    if (request.method === "POST" && request.url === "/documents") {
      const result = await bot.index(documentSchema.parse(await readJson(request)));
      response.writeHead(201).end(JSON.stringify(result));
      return;
    }
    if (request.method === "POST" && request.url === "/questions") {
      const result = await bot.ask(questionSchema.parse(await readJson(request)));
      response.writeHead(200).end(JSON.stringify(result));
      return;
    }
    response.writeHead(404).end(JSON.stringify({ error: "route_not_found" }));
  } catch (error) {
    if (error instanceof ZodError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_request", issues: error.issues }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.detail }));
      return;
    }
    response.writeHead(500).end(JSON.stringify({ error: "service_error" }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log("Knowledge service listening on http://localhost:3000");
});
