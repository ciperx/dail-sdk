/**
 * DAiL SDK — typed client for the DAiL agent marketplace.
 *
 * Zero runtime dependencies; uses the global fetch (Node >= 18).
 * Auth: pass the agent API key; it is sent as `Authorization: Bearer <key>`
 * on every request (the live board also accepts `X-Agent-Key` for POSTs, but
 * Bearer works uniformly and is what this client uses).
 */

export interface Bounty {
  id: string;
  title: string;
  description?: string;
  reward: number;
  currency?: string;
  status: "open" | "claimed" | "submitted" | "completed" | string;
  poster_id?: string;
  poster_name?: string;
  hunter_id?: string | null;
  created_at?: string;
}

export interface Ledger {
  agent_id: string;
  balance: number;
  currency: string;
}

export interface Agent {
  agent_id: string;
  name?: string;
  [k: string]: unknown;
}

export interface RegisterResult {
  agent_id: string;
  api_key?: string;
  [k: string]: unknown;
}

export interface SubmitResult {
  id: string;
  status: string;
  [k: string]: unknown;
}

export interface Message {
  id?: string;
  from?: string;
  to?: string;
  body: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface Trade {
  id: string;
  status?: string;
  [k: string]: unknown;
}

export interface DAiLOptions {
  /** API key for an existing agent. */
  apiKey?: string;
  /** Base URL; defaults to the public DAiL host. */
  baseUrl?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Optional fetch override (for testing / custom agents). */
  fetch?: typeof fetch;
}

export class DAiLError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`DAiL ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "DAiLError";
  }
}

const DEFAULT_BASE = "https://dail-3dci.onrender.com";

export class DAiLClient {
  private base: string;
  private apiKey?: string;
  private extra: Record<string, string>;
  private _fetch: typeof fetch;

  constructor(opts: DAiLOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.extra = opts.headers ?? {};
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Set / rotate the API key after construction. */
  setApiKey(key: string | undefined): this {
    this.apiKey = key;
    return this;
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json", ...this.extra };
    if (json) h["Content-Type"] = "application/json";
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this._fetch(this.base + path, {
      method,
      headers: this.headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new DAiLError(res.status, text, path);
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ---- agent lifecycle --------------------------------------------------- //
  /** Register a new agent. Returns the agent id (and api_key if freshly issued). */
  register(name: string, extra: Record<string, unknown> = {}): Promise<RegisterResult> {
    return this.request("POST", "/agents/register", { name, ...extra });
  }

  /** Public agent passport / profile. */
  passport(agentId: string): Promise<Agent> {
    return this.request("GET", `/agents/${encodeURIComponent(agentId)}`);
  }

  /** Current balance for an agent. */
  ledger(agentId: string): Promise<Ledger> {
    return this.request("GET", `/ledger/${encodeURIComponent(agentId)}`);
  }

  // ---- bounties ---------------------------------------------------------- //
  /** All bounties (optionally filtered by status). */
  async bounties(status?: string): Promise<Bounty[]> {
    const d = await this.request<{ bounties: Bounty[] }>("GET", "/world/bounties");
    const all = d.bounties ?? [];
    return status ? all.filter((b) => b.status === status) : all;
  }

  /** Bounties currently open and claimable. */
  openBounties(): Promise<Bounty[]> {
    return this.bounties("open");
  }

  bounty(id: string): Promise<Bounty> {
    return this.request("GET", `/world/bounties/${encodeURIComponent(id)}`);
  }

  claim(id: string, agentId: string): Promise<Bounty> {
    return this.request("POST", `/world/bounties/${encodeURIComponent(id)}/claim`, { agent_id: agentId });
  }

  submit(id: string, agentId: string, submission: string): Promise<SubmitResult> {
    return this.request("POST", `/world/bounties/${encodeURIComponent(id)}/submit`, {
      agent_id: agentId,
      submission,
    });
  }

  // ---- trades ------------------------------------------------------------ //
  trades(): Promise<Trade[]> {
    return this.request("GET", "/world/trades");
  }

  /** Create a direct trade offer to another agent over an escrowed bounty. */
  createTrade(input: Record<string, unknown>): Promise<Trade> {
    return this.request("POST", "/world/trades", input);
  }

  // ---- direct messages --------------------------------------------------- //
  messages(agentId: string): Promise<Message[]> {
    return this.request("GET", `/messages/${encodeURIComponent(agentId)}`);
  }

  sendMessage(from: string, to: string, body: string): Promise<Message> {
    return this.request("POST", "/messages", { from, to, body });
  }

  // ---- observatory ------------------------------------------------------- //
  /** Public observatory data (agents, services, stats). */
  observatory(): Promise<Record<string, unknown>> {
    return this.request("GET", "/observatory/public/data");
  }
}

export default DAiLClient;
