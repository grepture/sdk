export type PromptRef = {
  slug: string;
  /** Specific version number, "draft", or omit for active version */
  version?: number | "draft";
  /** Template variables to interpolate */
  variables?: Record<string, string>;
};

export type PromptMessage = {
  role: string;
  content: string;
};

export type PromptVariable = {
  name: string;
  type: string;
  default?: string;
};

export type PromptTemplate = {
  slug: string;
  name: string;
  skip_rules: boolean;
  version: number | null;
  messages: PromptMessage[];
  variables: PromptVariable[] | null;
};

export type AssembledPrompt = {
  messages: PromptMessage[];
  metadata: {
    slug: string;
    name: string;
    version: number | null;
    skip_rules: boolean;
  };
};

export type PromptListItem = {
  id: string;
  slug: string;
  name: string;
  active_version: number | null;
  updated_at: string;
};

/** A messages array carrying prompt metadata, serializable via JSON. */
export type PromptMessages = Array<{
  role: string;
  content: string;
  _grepture_prompt?: PromptRef;
}>;

/**
 * Create a messages array that carries prompt resolution metadata.
 *
 * The wrapped fetch in `clientOptions()` detects the marker,
 * sets the prompt headers, and replaces messages with `[]` before sending.
 */
export function createPromptMessages(ref: PromptRef): PromptMessages {
  return [{ role: "user", content: "", _grepture_prompt: ref }];
}

/**
 * Build prompt headers for use with any OpenAI-compatible SDK.
 *
 * Returns a plain object of headers that can be spread into request options.
 */
export function promptHeaders(ref: PromptRef): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Grepture-Prompt": formatSlugRef(ref.slug, ref.version),
  };

  if (ref.variables && Object.keys(ref.variables).length > 0) {
    headers["X-Grepture-Vars"] = JSON.stringify(ref.variables);
  }

  return headers;
}

/**
 * Resolve Handlebars-style templates in prompt messages.
 * Supports: {{variable}}, {{#if var}}...{{else}}...{{/if}}, {{#each var}}...{{/each}}
 */
export function resolveMessages(
  messages: PromptMessage[],
  variables: Record<string, string>,
): PromptMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: resolveTemplate(msg.content, variables),
  }));
}

export function resolveTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;

  // Handle {{ #if var }}...{{ /if }} blocks
  result = result.replace(
    /\{\{\s*#if\s+(\w+)\s*\}\}([\s\S]*?)(?:\{\{\s*else\s*\}\}([\s\S]*?))?\{\{\s*\/if\s*\}\}/g,
    (_, varName, ifBlock, elseBlock) => {
      const value = variables[varName];
      if (value && value !== "false" && value !== "0") {
        return resolveTemplate(ifBlock, variables);
      }
      return elseBlock ? resolveTemplate(elseBlock, variables) : "";
    },
  );

  // Handle {{ #each var }}...{{ /each }} blocks
  result = result.replace(
    /\{\{\s*#each\s+(\w+)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g,
    (_, varName, block) => {
      const value = variables[varName];
      if (!value) return "";
      try {
        const items = JSON.parse(value);
        if (!Array.isArray(items)) return "";
        return items
          .map((item: unknown) => {
            const itemVars =
              typeof item === "object" && item !== null
                ? {
                    ...variables,
                    ...(item as Record<string, string>),
                    this: JSON.stringify(item),
                  }
                : { ...variables, this: String(item) };
            return resolveTemplate(block, itemVars);
          })
          .join("");
      } catch {
        return "";
      }
    },
  );

  // Handle {{ variable }} interpolation
  result = result.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, varName) => {
    return variables[varName] ?? "";
  });

  return result;
}

export function formatSlugRef(
  slug: string,
  version?: number | "draft",
): string {
  if (version === "draft") return `${slug}@draft`;
  if (typeof version === "number") return `${slug}@${version}`;
  return slug;
}

type PromptNamespaceConfig = {
  apiKey: string;
  proxyUrl: string;
};

export class PromptNamespace {
  private readonly config: PromptNamespaceConfig;

  constructor(config: PromptNamespaceConfig) {
    this.config = config;
  }

  /**
   * Return a messages array for server-side prompt resolution.
   *
   * Pass the result as `messages` in any OpenAI-compatible SDK call
   * when using `clientOptions()`. The proxy resolves the template.
   *
   * ```ts
   * const res = await openai.chat.completions.create({
   *   model: "gpt-4o",
   *   messages: grepture.prompt.use("support-reply", {
   *     variables: { issue: "...", tone: "friendly" },
   *   }),
   * });
   * ```
   */
  use(
    slug: string,
    options?: {
      variables?: Record<string, string>;
      version?: number | "draft";
    },
  ): PromptMessages {
    return createPromptMessages({
      slug,
      version: options?.version,
      variables: options?.variables,
    });
  }

  /**
   * Fetch and resolve a prompt template client-side.
   *
   * Makes one request to the proxy to fetch the template, resolves
   * variables locally, and returns the final messages with metadata.
   * Useful when you want to inspect or modify messages before sending.
   *
   * ```ts
   * const { messages, model } = await grepture.prompt.assemble("support-reply", {
   *   variables: { issue: ticket.text, tone: "friendly" },
   * });
   * // Append extra context
   * messages.push({ role: "user", content: extraContext });
   * ```
   */
  async assemble(
    slug: string,
    options?: {
      variables?: Record<string, string>;
      version?: number | "draft";
    },
  ): Promise<AssembledPrompt> {
    const template = await this.get(slug, { version: options?.version });
    const variables = options?.variables ?? {};
    const messages = resolveMessages(template.messages, variables);

    return {
      messages,
      metadata: {
        slug: template.slug,
        name: template.name,
        version: template.version,
        skip_rules: template.skip_rules,
      },
    };
  }

  /**
   * Fetch a raw prompt template without resolving variables.
   *
   * Returns messages with `{{handlebars}}` placeholders intact,
   * plus the variable schema. Useful for caching a template and
   * resolving it multiple times with different variable sets.
   *
   * ```ts
   * const template = await grepture.prompt.get("support-reply");
   * const resolved1 = grepture.prompt.resolve(template.messages, vars1);
   * const resolved2 = grepture.prompt.resolve(template.messages, vars2);
   * ```
   */
  async get(
    slug: string,
    options?: { version?: number | "draft" },
  ): Promise<PromptTemplate> {
    const slugRef = formatSlugRef(slug, options?.version);
    const url = `${this.config.proxyUrl}/v1/prompts/${encodeURIComponent(slugRef)}`;

    const response = await globalThis.fetch(url, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to fetch prompt "${slugRef}": ${response.status} ${body}`);
    }

    return (await response.json()) as PromptTemplate;
  }

  /**
   * Resolve raw template messages with variables locally.
   *
   * Pure function — no network calls. Pair with `.get()` to cache a
   * template and resolve it multiple times with different variable sets.
   */
  resolve(
    messages: PromptMessage[],
    variables: Record<string, string>,
  ): PromptMessage[] {
    return resolveMessages(messages, variables);
  }

  /**
   * List all prompts for the team.
   *
   * ```ts
   * const prompts = await grepture.prompt.list();
   * for (const p of prompts) {
   *   console.log(`${p.slug} (v${p.active_version})`);
   * }
   * ```
   */
  async list(): Promise<PromptListItem[]> {
    const url = `${this.config.proxyUrl}/v1/prompts`;

    const response = await globalThis.fetch(url, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list prompts: ${response.status} ${body}`);
    }

    return (await response.json()) as PromptListItem[];
  }
}
