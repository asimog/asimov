// An offline OpenAI-compatible server (docs/24 section 10): POST /v1/chat/completions and /v1/embeddings. The Python
// engines point their *_BASE_URL here in tests, so BettaFish and MiroShark run end to end with no network and no key.
// `respond` sees the system and user text and returns the answer; the default echoes a small JSON object.
import http from "node:http";

export type StubReq = { model: string; system: string; user: string; json: boolean };
export async function llmStub(respond: (r: StubReq) => string = () => "{}"): Promise<{ url: string; calls: StubReq[]; close(): void }> {
  const calls: StubReq[] = [];
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const send = (body: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      const j = b ? JSON.parse(b) : {};
      if (req.url?.endsWith("/embeddings")) {
        const inputs: string[] = Array.isArray(j.input) ? j.input : [j.input];
        return send({ object: "list", data: inputs.map((s, i) => ({ object: "embedding", index: i, embedding: Array.from({ length: Number(j.dimensions ?? 8) }, (_, k) => ((s.length * (k + 1)) % 97) / 97) })), model: j.model });
      }
      if (req.url?.endsWith("/chat/completions")) {
        const msgs = (j.messages ?? []) as { role: string; content: unknown }[];
        const text = (m: { content: unknown }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
        const r: StubReq = { model: j.model, system: msgs.filter((m) => m.role === "system").map(text).join("\n"), user: msgs.filter((m) => m.role !== "system").map(text).join("\n"), json: j.response_format?.type === "json_object" };
        calls.push(r);
        const content = respond(r);
        return send({ id: `stub-${calls.length}`, object: "chat.completion", model: j.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: Math.ceil((r.system.length + r.user.length) / 4), completion_tokens: Math.ceil(content.length / 4), total_tokens: 0 } });
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`, calls, close: () => srv.close() };
}
