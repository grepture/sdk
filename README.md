# @grepture/sdk

Drop-in fetch wrapper for routing AI API calls through [Grepture](https://grepture.com). Zero dependencies — works in Node, Bun, Deno, and edge runtimes.

## Install

```bash
npm install @grepture/sdk
```

## Quick Start

### Direct fetch

Use `grepture.fetch()` as a drop-in replacement for `fetch`. The SDK handles all proxy header plumbing automatically.

```typescript
import { Grepture } from "@grepture/sdk";

const grepture = new Grepture({
  apiKey: "gpt_abc123",
  proxyUrl: "https://proxy.grepture.com",
});

const res = await grepture.fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk-openai-key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
  }),
});

console.log(res.status);       // 200
console.log(res.requestId);    // "uuid"
console.log(res.rulesApplied); // ["rule-uuid-1"]
console.log(await res.json()); // parsed response body
```

### OpenAI SDK integration

Use `grepture.clientOptions()` to get a config object compatible with any OpenAI-shaped SDK constructor.

```typescript
import OpenAI from "openai";
import { Grepture } from "@grepture/sdk";

const grepture = new Grepture({
  apiKey: "gpt_abc123",
  proxyUrl: "https://proxy.grepture.com",
});

const client = new OpenAI(
  grepture.clientOptions({
    apiKey: "sk-openai-key",
    baseURL: "https://api.openai.com/v1",
  })
);

// Works exactly like normal — requests flow through Grepture
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "hi" }],
});
```

## Modes

The SDK supports two operating modes:

| Mode | Default | Traffic flow | Use case |
|------|---------|-------------|----------|
| `"proxy"` | Yes | App → Grepture → Provider | PII redaction, blocking, prompt management |
| `"trace"` | No | App → Provider (direct) | Observability and cost tracking without latency overhead |

In **proxy mode** (default), requests route through the Grepture proxy where detection rules are applied. In **trace mode**, requests go directly to the provider — the SDK captures metadata (tokens, model, latency, cost) asynchronously and sends it to the dashboard in the background.

```typescript
// Trace mode — direct to provider, traces sent async
const grepture = new Grepture({
  apiKey: "gpt_abc123",
  proxyUrl: "https://proxy.grepture.com",
  mode: "trace",
});

// Same API — clientOptions() and fetch() work identically
const client = new OpenAI(
  grepture.clientOptions({
    apiKey: "sk-openai-key",
    baseURL: "https://api.openai.com/v1",
  })
);
```

In serverless environments, call `flush()` before the function exits to send any pending traces:

```typescript
await grepture.flush();
```

## API

### `new Grepture(config)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `config.apiKey` | `string` | Your Grepture API key (`gpt_xxx`) |
| `config.proxyUrl` | `string` | Grepture proxy URL (e.g. `https://proxy.grepture.com`) |
| `config.mode` | `"proxy" \| "trace"` | Operating mode (default: `"proxy"`) |
| `config.traceId` | `string?` | Default trace ID for conversation tracing |

### `grepture.fetch(targetUrl, init?)`

Same signature as the standard `fetch`. Returns a `GreptureResponse` with additional metadata:

- `res.requestId` — unique request ID from the proxy
- `res.rulesApplied` — array of rule IDs that were applied
- `res.status`, `res.ok`, `res.headers`, `res.json()`, `res.text()` — standard Response properties

If you pass an `Authorization` header (for the target API), the SDK automatically moves it to `X-Grepture-Auth-Forward` and sets the Grepture auth header instead.

### `grepture.clientOptions(input)`

Returns `{ baseURL, apiKey, fetch }` for use with OpenAI-shaped SDK constructors.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input.apiKey` | `string` | Target API key (e.g. `sk-openai-key`) |
| `input.baseURL` | `string` | Target base URL (e.g. `https://api.openai.com/v1`) |

### `grepture.flush()`

Flushes any pending trace data. Only relevant in trace mode — use this in serverless or short-lived environments to ensure traces are sent before the process exits.

## Error Handling

The SDK throws typed errors on non-OK responses from the proxy:

```typescript
import { Grepture, AuthError, BlockedError } from "@grepture/sdk";

try {
  const res = await grepture.fetch(url, init);
} catch (e) {
  if (e instanceof BlockedError) {
    // Request blocked by a Grepture rule (403)
  } else if (e instanceof AuthError) {
    // Invalid Grepture API key (401)
  }
}
```

| Error Class | Status | When |
|-------------|--------|------|
| `BadRequestError` | 400 | Malformed request |
| `AuthError` | 401 | Invalid Grepture API key |
| `BlockedError` | 403 | Request blocked by a rule |
| `ProxyError` | 502/504 | Target unreachable or timed out |
| `GreptureError` | other | Any other non-OK status |
