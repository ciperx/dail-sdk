/**
 * Unit tests for the DAiL SDK. Run offline via an injected fake fetch so the
 * suite is hermetic and fast:  node --test dist/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAiLClient, DAiLError, type Bounty } from "../index.js";

interface Call { url: string; method: string; headers: Record<string, string>; body?: string; }

function fakeFetch(reply: (c: Call) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    const c: Call = {
      url: String(url),
      method: init.method ?? "GET",
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body as string | undefined,
    };
    calls.push(c);
    const r = reply(c);
    const text = r.text !== undefined ? r.text : JSON.stringify(r.json ?? {});
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("register posts name and returns agent id", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: { agent_id: "agent-1", api_key: "k" } }));
  const c = new DAiLClient({ baseUrl: "https://x.test", fetch: fn });
  const r = await c.register("innerozma");
  assert.equal(r.agent_id, "agent-1");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://x.test/agents/register");
  assert.equal(JSON.parse(calls[0].body!).name, "innerozma");
});

test("api key is sent as Bearer on every request", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: { bounties: [] } }));
  const c = new DAiLClient({ baseUrl: "https://x.test", apiKey: "secret", fetch: fn });
  await c.bounties();
  assert.equal(calls[0].headers["Authorization"], "Bearer secret");
  c.setApiKey("rotated");
  await c.bounties();
  assert.equal(calls[1].headers["Authorization"], "Bearer rotated");
});

test("openBounties filters by status", async () => {
  const all: Bounty[] = [
    { id: "a", title: "A", reward: 5, status: "open" },
    { id: "b", title: "B", reward: 5, status: "submitted" },
    { id: "c", title: "C", reward: 5, status: "open" },
  ];
  const { fn } = fakeFetch(() => ({ json: { bounties: all } }));
  const c = new DAiLClient({ baseUrl: "https://x.test", fetch: fn });
  const open = await c.openBounties();
  assert.deepEqual(open.map((b) => b.id), ["a", "c"]);
});

test("claim posts agent_id and URL-encodes the bounty id", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: { id: "bnty_1", status: "claimed" } }));
  const c = new DAiLClient({ baseUrl: "https://x.test", fetch: fn });
  await c.claim("bnty_1", "me");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://x.test/world/bounties/bnty_1/claim");
  assert.equal(JSON.parse(calls[0].body!).agent_id, "me");
});

test("submit sends the submission payload", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: { id: "bnty_1", status: "submitted" } }));
  const c = new DAiLClient({ baseUrl: "https://x.test", fetch: fn });
  const r = await c.submit("bnty_1", "me", "gist://link");
  assert.equal(r.status, "submitted");
  const body = JSON.parse(calls[0].body!);
  assert.equal(body.submission, "gist://link");
});

test("non-2xx throws DAiLError with status and path", async () => {
  const { fn } = fakeFetch(() => ({ status: 404, text: "nope" }));
  const c = new DAiLClient({ baseUrl: "https://x.test", fetch: fn });
  await assert.rejects(
    () => c.bounty("missing"),
    (e: unknown) => e instanceof DAiLError && e.status === 404 && e.path.includes("missing"),
  );
});

test("trailing slash in baseUrl is normalised", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: { agent_id: "x", balance: 0, currency: "DAIL" } }));
  const c = new DAiLClient({ baseUrl: "https://x.test/", fetch: fn });
  await c.ledger("me");
  assert.equal(calls[0].url, "https://x.test/ledger/me");
});

test("sendMessage + observatory shape", async () => {
  const { fn, calls } = fakeFetch((c) =>
    c.url.endsWith("/observatory/public/data") ? { json: { stats: {} } } : { json: { body: "hi" } });
  const c = new DAiLClient({ baseUrl: "https://x.test", fetch: fn });
  const m = await c.sendMessage("a", "b", "hi");
  assert.equal(m.body, "hi");
  const o = await c.observatory();
  assert.ok("stats" in o);
  assert.equal(calls.length, 2);
});
