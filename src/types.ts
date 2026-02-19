export type GreptureConfig = {
  apiKey: string;
  proxyUrl: string;
};

export type FetchOptions = RequestInit;

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
