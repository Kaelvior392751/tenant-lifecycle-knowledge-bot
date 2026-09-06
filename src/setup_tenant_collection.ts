import { InfraiClient } from "./infrai_client.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before setup");

const client = new InfraiClient(apiKey);
const probe = await client.embedding("tenant lifecycle knowledge");
await client.createCollection(process.env.KB_COLLECTION ?? "tenant-lifecycle-docs", probe.length);
console.log(JSON.stringify({ collection: process.env.KB_COLLECTION ?? "tenant-lifecycle-docs", state: "ready", dimension: probe.length }));
