export type EmbeddingsInput = string | string[];

export type EmbeddingsCreateParams = {
  model: string;
  input: EmbeddingsInput;
  dimensions?: number;
  encoding_format?: "float" | "base64";
  user?: string;
  /** When "block", returns an error if PII is detected instead of redacting. Default "redact". */
  onPii?: "redact" | "block";
  /** How PII is replaced before forwarding. Default "placeholder" preserves k-NN clustering. */
  strategy?: "placeholder" | "hash" | "mask";
  /** Optional caller-supplied OpenAI key (BYOK). If omitted, Grepture uses the stored provider key. */
  openaiKey?: string;
  /** Optional trace ID for cross-request grouping. */
  traceId?: string;
};

export type EmbeddingObject = {
  object: "embedding";
  embedding: number[] | string;
  index: number;
};

export type EmbeddingsResponse = {
  object: "list";
  data: EmbeddingObject[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
  redactions: {
    count: number;
    categories: string[];
  };
};

export class EmbeddingsNamespace {
  constructor(private readonly opts: { apiKey: string; proxyUrl: string }) {}

  async create(params: EmbeddingsCreateParams): Promise<EmbeddingsResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      "Content-Type": "application/json",
    };
    if (params.onPii) headers["x-grepture-on-pii"] = params.onPii;
    if (params.strategy) headers["x-grepture-redaction-strategy"] = params.strategy;
    if (params.openaiKey) headers["x-grepture-auth-forward"] = `Bearer ${params.openaiKey}`;
    if (params.traceId) headers["x-grepture-trace-id"] = params.traceId;

    const body: Record<string, unknown> = {
      model: params.model,
      input: params.input,
    };
    if (params.dimensions !== undefined) body.dimensions = params.dimensions;
    if (params.encoding_format) body.encoding_format = params.encoding_format;
    if (params.user) body.user = params.user;

    const res = await fetch(`${this.opts.proxyUrl}/v1/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Embeddings: non-JSON response (status ${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      const err = parsed as { error?: string; message?: string; categories?: string[]; count?: number };
      const msg = err?.message || err?.error || `HTTP ${res.status}`;
      const thrown = new Error(msg);
      Object.assign(thrown, {
        status: res.status,
        code: err?.error,
        categories: err?.categories,
        count: err?.count,
      });
      throw thrown;
    }

    const count = parseInt(res.headers.get("x-grepture-redactions") ?? "0", 10) || 0;
    const categoriesHeader = res.headers.get("x-grepture-pii-categories") ?? "";
    const categories = categoriesHeader ? categoriesHeader.split(",").filter(Boolean) : [];

    return {
      ...(parsed as Omit<EmbeddingsResponse, "redactions">),
      redactions: { count, categories },
    };
  }
}
