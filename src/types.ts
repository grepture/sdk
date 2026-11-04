export type GreptureConfig = {
  apiKey: string;
  proxyUrl: string;
  /** Default trace ID applied to all requests. Override per-request via FetchOptions or setTraceId(). */
  traceId?: string;
  /**
   * Session ID grouping many traces (e.g. one agent conversation, one user
   * session). Must be an existing session — create one via `POST /api/sessions`
   * or let `grepture dev` inject it. Proxy mode only.
   */
  sessionId?: string;
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
  /** Session ID for this request. Overrides the default set on the client. */
  sessionId?: string;
  /** Label for this request within a trace (e.g. "tool-call", "report-generation"). */
  label?: string;
  /** Arbitrary key-value metadata attached to this request. Merged with global metadata (per-request wins). */
  metadata?: Record<string, string>;
  /**
   * Capture a full debug pipeline trace (input → redaction → upstream → restored output)
   * for this request. Rows live for 24 hours and are visible in the dashboard's
   * debug view. Rejected when the team is in zero-data mode. Default `false`.
   *
   * Use sparingly: the captured row intentionally retains the raw input and
   * original→token mappings that redaction is designed to remove.
   */
  debug?: boolean;
  /**
   * Seconds the proxy waits for the provider to start responding, for this
   * request. Overrides your rule timeouts in either direction; capped at 600.
   * Proxy mode only.
   */
  gatewayTimeout?: number;
};

export type GreptureResponseMeta = {
  requestId: string;
  rulesApplied: string[];
  aiSampling: { used: number; limit: number } | null;
};

export type ClientOptionsInput = {
  /**
   * Your provider API key (OpenAI, Anthropic, etc.).
   *
   * Omit this to use a provider key stored in Grepture's dashboard. When omitted,
   * the SDK strips outgoing Authorization/x-api-key headers, and the proxy
   * resolves the team's stored key for the detected provider (plus any fallback
   * chain configured).
   */
  apiKey?: string;
  baseURL: string;
  /**
   * Capture debug pipeline traces for every request issued through this client.
   * Equivalent to setting `debug: true` on each `fetch()` call. Default `false`.
   */
  debug?: boolean;
  /**
   * Seconds the proxy waits for the provider to start responding, for every
   * request through this client. Overrides your rule timeouts; capped at 600.
   * Proxy mode only.
   */
  gatewayTimeout?: number;
};

export type ClientOptionsOutput = {
  baseURL: string;
  apiKey: string;
  fetch: typeof fetch;
};
