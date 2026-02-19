export class GreptureResponse {
  readonly requestId: string;
  readonly rulesApplied: string[];
  readonly aiSampling: { used: number; limit: number } | null;
  private readonly response: Response;

  constructor(response: Response) {
    this.response = response;
    this.requestId = response.headers.get("X-Request-Id") || "";
    const rulesHeader = response.headers.get("X-Grepture-Rules-Applied");
    this.rulesApplied = rulesHeader
      ? rulesHeader.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const samplingHeader = response.headers.get("X-Grepture-AI-Sampling");
    if (samplingHeader) {
      const [used, limit] = samplingHeader.split("/").map(Number);
      this.aiSampling = { used, limit };
    } else {
      this.aiSampling = null;
    }
  }

  get status(): number {
    return this.response.status;
  }

  get statusText(): string {
    return this.response.statusText;
  }

  get ok(): boolean {
    return this.response.ok;
  }

  get headers(): Headers {
    return this.response.headers;
  }

  get body(): ReadableStream<Uint8Array> | null {
    return this.response.body;
  }

  get bodyUsed(): boolean {
    return this.response.bodyUsed;
  }

  json(): Promise<unknown> {
    return this.response.json();
  }

  text(): Promise<string> {
    return this.response.text();
  }

  blob(): Promise<Blob> {
    return this.response.blob();
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.response.arrayBuffer();
  }

  formData(): Promise<FormData> {
    return this.response.formData();
  }

  clone(): GreptureResponse {
    return new GreptureResponse(this.response.clone());
  }
}
