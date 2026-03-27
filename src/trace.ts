import type { UsageInfo } from "./usage.js";

export type TraceEntry = {
  method: string;
  target_url: string;
  status_code: number;
  duration_ms: number;
  request_body: string | null;
  response_body: string | null;
  model: string | null;
  provider: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  trace_id: string | null;
  label: string | null;
  metadata: Record<string, string> | null;
  seq: number | null;
  streaming: boolean;
};

const MAX_BODY_BYTES = 50 * 1024; // 50KB cap per body
const MAX_BATCH_SIZE = 25;
const FLUSH_INTERVAL_MS = 2_000;

export class TraceSender {
  private buffer: TraceEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly proxyUrl: string;
  private readonly apiKey: string;

  constructor(proxyUrl: string, apiKey: string) {
    this.proxyUrl = proxyUrl;
    this.apiKey = apiKey;
  }

  push(entry: TraceEntry): void {
    // Cap bodies to prevent oversized payloads
    if (entry.request_body && entry.request_body.length > MAX_BODY_BYTES) {
      entry.request_body = entry.request_body.slice(0, MAX_BODY_BYTES);
    }
    if (entry.response_body && entry.response_body.length > MAX_BODY_BYTES) {
      entry.response_body = entry.response_body.slice(0, MAX_BODY_BYTES);
    }

    this.buffer.push(entry);

    if (this.buffer.length >= MAX_BATCH_SIZE) {
      this.fireFlush();
    } else if (!this.timer) {
      this.timer = setInterval(() => this.fireFlush(), FLUSH_INTERVAL_MS);
    }
  }

  /** Flush all buffered entries. Best-effort — never throws. */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    try {
      await this.send(batch);
    } catch {
      // Trace delivery is best-effort — never interrupt the caller
    }
  }

  /** Fire-and-forget flush — errors are swallowed. */
  private fireFlush(): void {
    this.clearTimer();
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.send(batch).catch(() => {});
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async send(batch: TraceEntry[]): Promise<void> {
    await globalThis.fetch(`${this.proxyUrl}/v1/trace`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ entries: batch }),
    });
  }

  static buildEntry(opts: {
    method: string;
    targetUrl: string;
    statusCode: number;
    durationMs: number;
    requestBody: string | null;
    responseBody: string | null;
    usage: UsageInfo | null;
    traceId: string | null;
    label: string | null;
    metadata: Record<string, string> | null;
    seq?: number | null;
    streaming: boolean;
  }): TraceEntry {
    return {
      method: opts.method,
      target_url: opts.targetUrl,
      status_code: opts.statusCode,
      duration_ms: opts.durationMs,
      request_body: opts.requestBody,
      response_body: opts.responseBody,
      model: opts.usage?.model ?? null,
      provider: opts.usage?.provider ?? null,
      prompt_tokens: opts.usage?.prompt_tokens ?? null,
      completion_tokens: opts.usage?.completion_tokens ?? null,
      total_tokens: opts.usage?.total_tokens ?? null,
      trace_id: opts.traceId,
      label: opts.label,
      metadata: opts.metadata,
      seq: opts.seq ?? null,
      streaming: opts.streaming,
    };
  }
}
