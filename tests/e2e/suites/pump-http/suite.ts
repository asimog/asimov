// pumpGet honours Retry-After as delta-seconds and as an HTTP date (docs/PIPELINE.md): after a 429 the lane waits that long
// before the next request. A local fake server stamps when each request arrives.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pumpGet } from "../../../../services/core/src/senses/pump-http.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "pump-http",
  proves: "After a 429 the next request on the lane waits for Retry-After, whether it is given in seconds or as an HTTP date.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const hits = new Map<string, number[]>();
    const server = createServer((req, res) => {
      const path = req.url ?? "";
      const seen = hits.get(path) ?? hits.set(path, []).get(path)!;
      seen.push(performance.now());
      if (seen.length === 1) {
        const retry = path.startsWith("/date") ? new Date(Date.now() + 3000).toUTCString() : "2";
        res.writeHead(429, { "Retry-After": retry });
        res.end("{}");
      } else {
        res.writeHead(200);
        res.end('{"ok":true}');
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const lane of ["date", "secs"]) {
        const first = await pumpGet(`${base}/${lane}`);
        const second = await pumpGet(`${base}/${lane}`);
        const [a, b] = hits.get(`/${lane}`)!;
        const waited = (b! - a!) / 1000;
        add(`${lane}: the first request is refused`, first.status === 429, `status ${first.status}`);
        add(`${lane}: the second request goes through`, second.status === 200 && second.body !== null, `status ${second.status}`);
        // an HTTP date has whole-second resolution: a date 3 s ahead is 2 to 3 s away
        const [lo, hi] = lane === "date" ? [1.9, 3.5] : [1.9, 2.8];
        add(`${lane}: the lane waited about the stated delay`, waited >= lo && waited <= hi, `${waited.toFixed(2)} s, want ${lo} to ${hi}`);
      }
      return { checks, metrics: {} };
    } finally {
      server.close();
    }
  },
};
