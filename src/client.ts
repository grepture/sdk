import type {
  GreptureConfig,
  FetchOptions,
  ClientOptionsInput,
  ClientOptionsOutput,
} from "./types.js";
import { GreptureResponse } from "./response.js";
import {
  GreptureError,
  AuthError,
  BadRequestError,
  BlockedError,
  ProxyError,
} from "./errors.js";
import {
  promptHeaders,
  PromptNamespace,
  type PromptRef,
} from "./prompts.js";
export class Grepture {
  private readonly config: GreptureConfig;
  private currentTraceId: string | undefined;

  /** Prompt management — use, assemble, get, resolve, list. */
  readonly prompt: PromptNamespace;

  constructor(config: GreptureConfig) {
    this.config = {
      ...config,
      proxyUrl: config.proxyUrl.replace(/\/+$/, ""),
    };
    this.currentTraceId = config.traceId;
    this.prompt = new PromptNamespace({
      apiKey: this.config.apiKey,
      proxyUrl: this.config.proxyUrl,
    });
  }

  /** Set or clear the default trace ID for all subsequent requests. */
  setTraceId(traceId: string | undefined): void {
    this.currentTraceId = traceId;
  }

  /** Get the current default trace ID. */
  getTraceId(): string | undefined {
    return this.currentTraceId;
  }

  async fetch(
    targetUrl: string,
    init?: FetchOptions,
  ): Promise<GreptureResponse> {
    const parsed = new URL(targetUrl);
    const proxyRequestUrl = `${this.config.proxyUrl}/proxy${parsed.pathname}${parsed.search}`;

    const headers = new Headers(init?.headers);

    // Move target Authorization to X-Grepture-Auth-Forward
    const targetAuth = headers.get("Authorization");
    if (targetAuth) {
      headers.set("X-Grepture-Auth-Forward", targetAuth);
    }

    // Set Grepture auth and target
    headers.set("Authorization", `Bearer ${this.config.apiKey}`);
    headers.set("X-Grepture-Target", targetUrl);

    // Set trace ID (per-request overrides default)
    const traceId = init?.traceId ?? this.currentTraceId;
    if (traceId) {
      headers.set("X-Grepture-Trace-Id", traceId);
    }

    const response = await globalThis.fetch(proxyRequestUrl, {
      ...init,
      headers,
    });

    this.throwOnError(response);

    return new GreptureResponse(response);
  }

  clientOptions(input: ClientOptionsInput): ClientOptionsOutput {
    const proxyBase = `${this.config.proxyUrl}/proxy/v1`;
    const greptureApiKey = this.config.apiKey;
    const targetBaseURL = input.baseURL.replace(/\/+$/, "");
    const getTraceId = () => this.currentTraceId;

    const wrappedFetch: typeof fetch = async (
      reqInput: RequestInfo | URL,
      reqInit?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof reqInput === "string"
          ? reqInput
          : reqInput instanceof URL
            ? reqInput.toString()
            : reqInput.url;

      const requestUrl = new URL(url);
      const proxyBaseUrl = new URL(proxyBase);

      // Extract relative path after the proxy base path
      const relativePath = requestUrl.pathname.slice(
        proxyBaseUrl.pathname.length,
      );
      const targetUrl =
        targetBaseURL + relativePath + requestUrl.search;

      const headers = new Headers(reqInit?.headers);

      // Detect prompt marker in request body and set headers
      let finalInit = reqInit;
      if (reqInit?.body && typeof reqInit.body === "string") {
        try {
          const body = JSON.parse(reqInit.body);
          if (
            Array.isArray(body.messages) &&
            body.messages.length === 1 &&
            body.messages[0]?._grepture_prompt
          ) {
            const ref: PromptRef = body.messages[0]._grepture_prompt;
            const ph = promptHeaders(ref);
            for (const [k, v] of Object.entries(ph)) {
              headers.set(k, v);
            }
            body.messages = [];
            finalInit = { ...reqInit, body: JSON.stringify(body) };
          }
        } catch {
          // not JSON, pass through
        }
      }

      // Move SDK auth to X-Grepture-Auth-Forward
      // Supports both standard Authorization and Azure's api-key header
      const authHeader = headers.get("Authorization");
      const azureApiKey = headers.get("api-key");
      if (authHeader) {
        headers.set("X-Grepture-Auth-Forward", authHeader);
      } else if (azureApiKey) {
        headers.set("X-Grepture-Auth-Forward", `Bearer ${azureApiKey}`);
        headers.delete("api-key");
      }

      // Set Grepture auth and target
      headers.set("Authorization", `Bearer ${greptureApiKey}`);
      headers.set("X-Grepture-Target", targetUrl);

      // Set trace ID if present
      const traceId = getTraceId();
      if (traceId) {
        headers.set("X-Grepture-Trace-Id", traceId);
      }

      return globalThis.fetch(url, { ...finalInit, headers });
    };

    return {
      baseURL: proxyBase,
      apiKey: input.apiKey,
      fetch: wrappedFetch,
    };
  }

  private throwOnError(response: Response): void {
    if (response.ok) return;

    const status = response.status;
    const statusText = response.statusText || "Request failed";

    switch (status) {
      case 400:
        throw new BadRequestError(statusText);
      case 401:
        throw new AuthError(statusText);
      case 403:
        throw new BlockedError(statusText);
      case 502:
      case 504:
        throw new ProxyError(status, statusText);
      default:
        if (!response.ok) {
          throw new GreptureError(status, statusText);
        }
    }
  }
}
