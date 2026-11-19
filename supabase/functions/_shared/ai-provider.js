const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_OUTPUT_TOKENS = 700;

export const AI_PROVIDERS = Object.freeze(['openai_compatible']);

export class AIProviderError extends Error {
  constructor(code, message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function envValue(env, name) {
  const value = env?.[name];
  if (value !== undefined && value !== null) return String(value);
  if (globalThis.Deno?.env?.get) return globalThis.Deno.env.get(name) ?? '';
  return globalThis.process?.env?.[name] ?? '';
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function optionalNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function readProviderConfig(env = {}) {
  const provider = envValue(env, 'AI_PROVIDER').trim().toLowerCase() || 'none';
  const baseUrl = envValue(env, 'AI_BASE_URL').trim();
  const model = envValue(env, 'AI_MODEL').trim();
  const apiKey = envValue(env, 'AI_API_KEY').trim();

  return Object.freeze({
    provider,
    baseUrl,
    model,
    apiKey,
    timeoutMs: clampInteger(envValue(env, 'AI_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS, 1000, 120000),
    maxOutputTokens: clampInteger(
      envValue(env, 'AI_MAX_OUTPUT_TOKENS'),
      DEFAULT_MAX_OUTPUT_TOKENS,
      100,
      4000,
    ),
    jsonMode: envValue(env, 'AI_JSON_MODE').trim().toLowerCase() !== 'false',
    costPerMillionInputTokens: optionalNumber(envValue(env, 'AI_COST_PER_MILLION_INPUT_TOKENS')),
    costPerMillionOutputTokens: optionalNumber(envValue(env, 'AI_COST_PER_MILLION_OUTPUT_TOKENS')),
  });
}

export function isProviderConfigured(config) {
  if (!config || config.provider === 'none') return false;
  if (!AI_PROVIDERS.includes(config.provider)) return false;
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

export function estimateCostUsd(config, usage = {}) {
  const inputRate = config?.costPerMillionInputTokens;
  const outputRate = config?.costPerMillionOutputTokens;
  if (inputRate === null && outputRate === null) return null;

  const inputTokens = Math.max(0, Number(usage.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(usage.outputTokens) || 0);
  const inputCost = inputRate === null ? 0 : (inputTokens / 1000000) * inputRate;
  const outputCost = outputRate === null ? 0 : (outputTokens / 1000000) * outputRate;
  return Number((inputCost + outputCost).toFixed(8));
}

function classifyFetchError(error) {
  if (error?.name === 'AbortError' || /abort/i.test(error?.message ?? '')) {
    return new AIProviderError('PROVIDER_TIMEOUT', 'The AI provider request timed out.', {
      retryable: true,
    });
  }
  return new AIProviderError(
    'PROVIDER_UNAVAILABLE',
    'The AI provider could not be reached.',
    { retryable: true },
  );
}

function classifyResponse(status, payload) {
  const rawMessage = payload?.error?.message ?? payload?.message ?? '';
  const message = String(rawMessage).replace(/[\r\n]+/g, ' ').slice(0, 300);

  if (status === 429 || /rate limit/i.test(message)) {
    return new AIProviderError('PROVIDER_RATE_LIMITED', 'The AI provider rate limit was reached.', {
      status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new AIProviderError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', {
      status,
      retryable: true,
    });
  }
  return new AIProviderError(
    'PROVIDER_ERROR',
    message || 'The AI provider rejected the request.',
    { status },
  );
}

function parseToolCall(toolCall) {
  const rawArguments = toolCall?.function?.arguments ?? '';
  let parsedArguments = rawArguments;
  if (typeof rawArguments === 'string' && rawArguments.trim()) {
    try {
      parsedArguments = JSON.parse(rawArguments);
    } catch {
      parsedArguments = rawArguments;
    }
  }

  return {
    id: toolCall?.id ?? '',
    name: toolCall?.function?.name ?? '',
    arguments: parsedArguments ?? {},
  };
}

function normalizeUsage(payload) {
  const usage = payload?.usage ?? {};
  const inputTokens = Math.max(
    0,
    Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
  );
  const outputTokens = Math.max(
    0,
    Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(0, Number(usage.total_tokens ?? inputTokens + outputTokens) || 0),
  };
}

export function createAIProvider(config, fetchImpl = globalThis.fetch) {
  if (!config || config.provider === 'none') {
    return {
      configured: false,
      provider: 'none',
      model: '',
      chat: async () => {
        throw new AIProviderError(
          'PROVIDER_NOT_CONFIGURED',
          'No AI provider is configured for this workspace.',
        );
      },
    };
  }

  if (!AI_PROVIDERS.includes(config.provider)) {
    throw new AIProviderError(
      'PROVIDER_UNSUPPORTED',
      'The configured AI provider is not supported.',
    );
  }

  if (!config.apiKey || !config.baseUrl || !config.model) {
    throw new AIProviderError(
      'PROVIDER_CONFIGURATION_ERROR',
      'The AI provider configuration is incomplete.',
    );
  }

  if (typeof fetchImpl !== 'function') {
    throw new AIProviderError(
      'PROVIDER_CONFIGURATION_ERROR',
      'A fetch implementation is required for AI provider calls.',
    );
  }

  let endpoint;
  try {
    endpoint = new URL(config.baseUrl.replace(/\/$/, '') + '/chat/completions');
  } catch {
    throw new AIProviderError(
      'PROVIDER_CONFIGURATION_ERROR',
      'The AI provider base URL is invalid.',
    );
  }

  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
    throw new AIProviderError(
      'PROVIDER_CONFIGURATION_ERROR',
      'The AI provider base URL must use HTTPS.',
    );
  }

  return {
    configured: true,
    provider: config.provider,
    model: config.model,
    chat: async ({ messages, tools = [], toolChoice = null, maxTokens = null, temperature = 0.2 }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const body = {
        model: config.model,
        messages,
        temperature,
        max_tokens: Math.min(Math.max(Number(maxTokens) || config.maxOutputTokens, 100), 4000),
      };

      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
      }

      if (config.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      let response;
      try {
        response = await fetchImpl(endpoint.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'OrderFlow-AI-Assistant',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        throw classifyFetchError(error);
      } finally {
        clearTimeout(timer);
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw classifyResponse(response.status, payload);
      }

      const choice = payload?.choices?.[0];
      if (!choice) {
        throw new AIProviderError(
          'PROVIDER_INVALID_RESPONSE',
          'The AI provider returned no response choice.',
        );
      }

      const message = choice.message ?? {};
      const toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls.map(parseToolCall)
        : [];

      return {
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        finishReason: choice.finish_reason ?? null,
        providerMessageId: payload.id ?? null,
        usage: normalizeUsage(payload),
      };
    },
  };
}
