export type GreptureConfig = {
  apiKey: string;
  proxyUrl: string;
  /** Default trace ID applied to all requests. Override per-request via FetchOptions or setTraceId(). */
  traceId?: string;
};

export type FetchOptions = RequestInit & {
  /** Trace ID for this request. Overrides the default set on the client. */
  traceId?: string;
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
