export type GreptureConfig = {
  apiKey: string;
  proxyUrl: string;
  /** Default trace ID applied to all requests. Override per-request via FetchOptions or setTraceId(). */
  traceId?: string;
  /**
   * SDK operating mode.
   * - `"proxy"` (default): all requests route through the Grepture proxy (rules, PII redaction, blocking).
   * - `"trace"`: requests go directly to the LLM provider; trace data is sent async to the proxy for observability.
   */
  mode?: "proxy" | "trace";
};

export type FetchOptions = RequestInit & {
  /** Trace ID for this request. Overrides the default set on the client. */
  traceId?: string;
  /** Label for this request within a trace (e.g. "tool-call", "report-generation"). */
  label?: string;
  /** Arbitrary key-value metadata attached to this request. Merged with global metadata (per-request wins). */
  metadata?: Record<string, string>;
};

export type GreptureResponseMeta = {
  requestId: string;
  rulesApplied: string[];
  aiSampling: { used: number; limit: number } | null;
};

export type ClientOptionsInput = {
  apiKey: string;
  baseURL: string;
};

export type ClientOptionsOutput = {
  baseURL: string;
  apiKey: string;
  fetch: typeof fetch;
};
