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

export class Grepture {
  private readonly config: GreptureConfig;

  constructor(config: GreptureConfig) {
    this.config = {
      ...config,
      proxyUrl: config.proxyUrl.replace(/\/+$/, ""),
    };
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

      return globalThis.fetch(url, { ...reqInit, headers });
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
