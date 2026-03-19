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
import { TraceSender } from "./trace.js";
import { extractUsage, extractUsageFromSSELines } from "./usage.js";

export class Grepture {
  private readonly config: GreptureConfig;
  private currentTraceId: string | undefined;
  private traceSender: TraceSender | null = null;

  /** Prompt management — use, assemble, get, resolve, list. */
  readonly prompt: PromptNamespace;

  constructor(config: GreptureConfig) {
    this.config = {
      ...config,
      proxyUrl: config.proxyUrl.replace(/\/+$/, ""),
    };
    this.currentTraceId = config.traceId;
    this.prompt = new TraceAwarePromptNamespace({
      apiKey: this.config.apiKey,
      proxyUrl: this.config.proxyUrl,
      mode: this.config.mode ?? "proxy",
    });

    if (this.isTraceMode) {
      this.traceSender = new TraceSender(
        this.config.proxyUrl,
        this.config.apiKey,
      );
    }
  }

  private get isTraceMode(): boolean {
    return this.config.mode === "trace";
  }

  /** Set or clear the default trace ID for all subsequent requests. */
  setTraceId(traceId: string | undefined): void {
    this.currentTraceId = traceId;
  }

  /** Get the current default trace ID. */
  getTraceId(): string | undefined {
    return this.currentTraceId;
  }

  /**
   * Flush pending trace data. No-op in proxy mode.
   * Call before process exit in serverless / short-lived environments.
   */
  async flush(): Promise<void> {
    if (this.traceSender) {
      await this.traceSender.flush();
    }
  }

  async fetch(
    targetUrl: string,
    init?: FetchOptions,
  ): Promise<GreptureResponse> {
    if (this.isTraceMode) {
      return this.fetchTrace(targetUrl, init);
    }
    return this.fetchProxy(targetUrl, init);
  }

  private async fetchProxy(
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

  private async fetchTrace(
    targetUrl: string,
    init?: FetchOptions,
  ): Promise<GreptureResponse> {
    const traceId = init?.traceId ?? this.currentTraceId ?? null;
    const requestBody =
      init?.body && typeof init.body === "string" ? init.body : null;

    // Detect streaming from request body
    let isStreaming = false;
    if (requestBody) {
      try {
        isStreaming = JSON.parse(requestBody).stream === true;
      } catch { /* not JSON */ }
    }

    const startedAt = performance.now();

    // Send directly to the target — no URL rewriting, no header manipulation
    const response = await globalThis.fetch(targetUrl, init);

    const durationMs = Math.round(performance.now() - startedAt);

    if (isStreaming && response.body) {
      // Wrap stream: pass through immediately, capture last few SSE lines for usage
      const traceSender = this.traceSender!;
      const wrappedBody = wrapStreamForTrace(response.body, {
        method: init?.method ?? "POST",
        targetUrl,
        statusCode: response.status,
        durationMs,
        requestBody,
        traceId,
        traceSender,
      });

      const wrappedResponse = new Response(wrappedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      return new GreptureResponse(wrappedResponse, {
        requestId: crypto.randomUUID(),
        rulesApplied: [],
      });
    }

    // Buffered: clone body, extract usage, send trace — don't block the caller
    response
      .clone()
      .text()
      .then((body) => {
        const usage = extractUsage(body, targetUrl);
        this.traceSender!.push(
          TraceSender.buildEntry({
            method: init?.method ?? "POST",
            targetUrl,
            statusCode: response.status,
            durationMs,
            requestBody,
            responseBody: body,
            usage,
            traceId,
            streaming: false,
          }),
        );
      })
      .catch(() => {});

    return new GreptureResponse(response, {
      requestId: crypto.randomUUID(),
      rulesApplied: [],
    });
  }

  clientOptions(input: ClientOptionsInput): ClientOptionsOutput {
    if (this.isTraceMode) {
      return this.clientOptionsTrace(input);
    }
    return this.clientOptionsProxy(input);
  }

  private clientOptionsProxy(input: ClientOptionsInput): ClientOptionsOutput {
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

  private clientOptionsTrace(input: ClientOptionsInput): ClientOptionsOutput {
    const targetBaseURL = input.baseURL.replace(/\/+$/, "");
    const getTraceId = () => this.currentTraceId ?? null;
    const traceSender = this.traceSender!;

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

      const startedAt = performance.now();
      const requestBody =
        reqInit?.body && typeof reqInit.body === "string"
          ? reqInit.body
          : null;

      // Detect if this is a streaming request
      let isStreaming = false;
      if (requestBody) {
        try {
          const parsed = JSON.parse(requestBody);
          isStreaming = parsed.stream === true;
        } catch {
          // not JSON
        }
      }

      const traceId = getTraceId();

      // Send directly to the real provider URL — no rewriting
      const response = await globalThis.fetch(url, reqInit);

      const durationMs = Math.round(performance.now() - startedAt);

      if (isStreaming && response.body) {
        const wrappedBody = wrapStreamForTrace(response.body, {
          method: reqInit?.method ?? "POST",
          targetUrl: url,
          statusCode: response.status,
          durationMs,
          requestBody,
          traceId,
          traceSender,
        });

        return new Response(wrappedBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      // Buffered response — clone and extract usage async
      response
        .clone()
        .text()
        .then((body) => {
          const usage = extractUsage(body, url);
          traceSender.push(
            TraceSender.buildEntry({
              method: reqInit?.method ?? "POST",
              targetUrl: url,
              statusCode: response.status,
              durationMs,
              requestBody,
              responseBody: body,
              usage,
              traceId,
              streaming: false,
            }),
          );
        })
        .catch(() => {});

      return response;
    };

    return {
      baseURL: targetBaseURL,
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

/**
 * Prompt namespace that guards `.use()` in trace mode.
 */
class TraceAwarePromptNamespace extends PromptNamespace {
  private readonly mode: "proxy" | "trace";

  constructor(config: { apiKey: string; proxyUrl: string; mode: "proxy" | "trace" }) {
    super({ apiKey: config.apiKey, proxyUrl: config.proxyUrl });
    this.mode = config.mode;
  }

  override use(
    slug: string,
    options?: {
      variables?: Record<string, string>;
      version?: number | "draft";
    },
  ) {
    if (this.mode === "trace") {
      throw new Error(
        `prompt.use() is not supported in trace mode because it requires the proxy to resolve prompts. ` +
          `Use prompt.assemble("${slug}") instead, which fetches the template and resolves it locally.`,
      );
    }
    return super.use(slug, options);
  }
}

/**
 * Wrap a ReadableStream to pass chunks through with zero latency
 * while capturing the last few SSE `data:` lines for usage extraction.
 */
function wrapStreamForTrace(
  body: ReadableStream<Uint8Array>,
  opts: {
    method: string;
    targetUrl: string;
    statusCode: number;
    durationMs: number;
    requestBody: string | null;
    traceId: string | null;
    traceSender: TraceSender;
  },
): ReadableStream<Uint8Array> {
  const lastDataLines: string[] = [];
  const MAX_LINES = 10;
  const decoder = new TextDecoder();
  let partial = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Pass through immediately — zero latency
      controller.enqueue(chunk);

      // Accumulate only last few data: lines for usage extraction
      const text = decoder.decode(chunk, { stream: true });
      partial += text;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:") && trimmed !== "data: [DONE]") {
          lastDataLines.push(trimmed);
          if (lastDataLines.length > MAX_LINES) {
            lastDataLines.shift();
          }
        }
      }
    },
    flush() {
      if (partial.trim().startsWith("data:") && partial.trim() !== "data: [DONE]") {
        lastDataLines.push(partial.trim());
        if (lastDataLines.length > MAX_LINES) {
          lastDataLines.shift();
        }
      }

      const usage = extractUsageFromSSELines(lastDataLines, opts.targetUrl);
      opts.traceSender.push(
        TraceSender.buildEntry({
          method: opts.method,
          targetUrl: opts.targetUrl,
          statusCode: opts.statusCode,
          durationMs: opts.durationMs,
          requestBody: opts.requestBody,
          responseBody: null,
          usage,
          traceId: opts.traceId,
          streaming: true,
        }),
      );
    },
  });

  return body.pipeThrough(transform);
}
