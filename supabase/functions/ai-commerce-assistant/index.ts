import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import {
  AIProviderError,
  createAIProvider,
  estimateCostUsd,
  isProviderConfigured,
  readProviderConfig,
} from '../_shared/ai-provider.js';
import {
  SUPPORTED_LANGUAGES,
  TOOL_DEFINITIONS,
  buildSystemPrompt,
  detectLanguage,
  parseAssistantOutput,
  resolveLanguage,
  validateToolCall,
} from '../_shared/ai-tools.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL_RESULT_LIMIT = 16000;

function env(name) {
  return Deno.env.get(name) ?? '';
}

function corsHeaders(request) {
  const allowed = env('AI_ALLOWED_ORIGINS')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const origin = request.headers.get('Origin') ?? '';
  const allowOrigin = allowed.length === 0 || allowed.includes(origin) ? (origin || '*') : allowed[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function jsonResponse(request, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

function errorResponse(request, code, message, status, details = null) {
  return jsonResponse(
    request,
    { error: code, code, message, status, details },
    status,
  );
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ''));
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function cleanError(error) {
  return String(error?.message ?? 'Request failed.').replace(/[\r\n]+/g, ' ').slice(0, 300);
}

async function authenticateUser(request, supabaseUrl, anonKey) {
  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return { client, user: data.user };
}

const ORDER_TOOL_NAMES = new Set([
  'get_customer_information',
  'prepare_order_draft',
  'update_order_draft',
  'calculate_order_quote',
  'get_order_summary',
  'request_customer_confirmation',
  'submit_confirmed_order_for_business_approval',
  'ai_search_order_preparations',
]);

function toolRpcArguments(name, argumentsValue, businessId, context) {
  const base = { p_business_id: businessId };

  if (name === 'search_products') {
    return {
      ...base,
      p_query: argumentsValue.query,
      p_limit: argumentsValue.limit ?? 8,
    };
  }
  if (name === 'get_product_details' || name === 'get_product_variants') {
    return { ...base, p_product_id: argumentsValue.product_id };
  }
  if (name === 'check_product_availability') {
    return {
      ...base,
      p_product_id: argumentsValue.product_id,
      p_variant_id: argumentsValue.variant_id ?? null,
    };
  }
  if (name === 'get_customer_order_status') {
    return {
      ...base,
      p_order_number: argumentsValue.order_number,
      p_verification: argumentsValue.verification,
    };
  }
  if (name === 'get_customer_information') {
    return {
      ...base,
      p_customer_id: argumentsValue.customer_id ?? null,
      p_phone: argumentsValue.phone ?? null,
      p_email: argumentsValue.email ?? null,
      p_conversation_id: context.conversationId ?? null,
    };
  }
  if (name === 'prepare_order_draft') {
    return {
      ...base,
      p_conversation_id: context.conversationId ?? null,
      p_customer_id: null,
      p_customer_name: argumentsValue.customer_name ?? null,
      p_customer_phone: argumentsValue.customer_phone ?? null,
      p_customer_email: argumentsValue.customer_email ?? null,
      p_items: JSON.stringify(argumentsValue.items ?? []),
      p_delivery_method: argumentsValue.delivery_method ?? null,
      p_delivery_address: argumentsValue.delivery_address ?? null,
      p_delivery_instructions: argumentsValue.delivery_instructions ?? null,
      p_notes: argumentsValue.notes ?? null,
      p_idempotency_key: context.idempotencyKey,
    };
  }
  if (name === 'update_order_draft') {
    return {
      p_order_id: argumentsValue.order_id,
      p_items: argumentsValue.items ? JSON.stringify(argumentsValue.items) : null,
      p_customer_name: argumentsValue.customer_name ?? null,
      p_customer_phone: argumentsValue.customer_phone ?? null,
      p_customer_email: argumentsValue.customer_email ?? null,
      p_delivery_method: argumentsValue.delivery_method ?? null,
      p_delivery_address: argumentsValue.delivery_address ?? null,
      p_delivery_instructions: argumentsValue.delivery_instructions ?? null,
      p_notes: argumentsValue.notes ?? null,
      p_idempotency_key: context.idempotencyKey,
    };
  }
  if (name === 'calculate_order_quote') {
    return {
      p_order_id: argumentsValue.order_id,
      p_idempotency_key: context.idempotencyKey,
    };
  }
  if (name === 'get_order_summary') {
    return { p_order_id: argumentsValue.order_id };
  }
  if (name === 'request_customer_confirmation') {
    return {
      p_order_id: argumentsValue.order_id,
      p_idempotency_key: context.idempotencyKey,
    };
  }
  if (name === 'submit_confirmed_order_for_business_approval') {
    return {
      p_order_id: argumentsValue.order_id,
      p_confirmation_text: context.message,
      p_confirmation_source: 'chat_message',
      p_confirmation_reference: context.requestId,
      p_idempotency_key: context.idempotencyKey,
    };
  }
  if (name === 'ai_search_order_preparations') {
    return {
      ...base,
      p_search: argumentsValue.search ?? null,
      p_status: argumentsValue.status ?? null,
      p_limit: argumentsValue.limit ?? 25,
      p_offset: 0,
    };
  }
  return base;
}

function collectSourceRecords(name, result, sources) {
  if (!result || typeof result !== 'object') return;

  if (name === 'search_products' && Array.isArray(result.products)) {
    for (const product of result.products) {
      if (!product?.id) continue;
      sources.set(`product:${product.id}`, {
        type: 'product',
        id: product.id,
        label: product.name ?? product.id,
        record: product,
      });
    }
  }

  if (name === 'get_product_details' && result.found && result.product?.id) {
    sources.set(`product:${result.product.id}`, {
      type: 'product',
      id: result.product.id,
      label: result.product.name ?? result.product.id,
      record: result.product,
    });
  }

  if (name === 'get_product_variants' && result.found) {
    sources.set(`variants:${result.productId}`, {
      type: 'variants',
      id: result.productId,
      label: `Variants for ${result.productId}`,
      record: result,
    });
  }

  if (name === 'check_product_availability' && result.found) {
    const id = result.variantId ?? result.productId;
    sources.set(`availability:${id}`, {
      type: 'availability',
      id,
      label: `Availability for ${id}`,
      record: result,
    });
  }

  if (name === 'get_business_information' && result.found) {
    sources.set(`business:${result.businessId}`, {
      type: 'business',
      id: result.businessId,
      label: result.businessName ?? 'Business information',
      record: result,
    });
  }

  if (name === 'get_business_policies' && Array.isArray(result.policies)) {
    for (const policy of result.policies) {
      if (!policy?.id) continue;
      sources.set(`policy:${policy.id}`, {
        type: 'policy',
        id: policy.id,
        label: policy.title ?? policy.category ?? policy.id,
        record: policy,
      });
    }
  }

  if (name === 'get_customer_order_status' && result.found) {
    sources.set(`order:${result.orderNumber}`, {
      type: 'order',
      id: result.orderNumber,
      label: result.orderNumber,
      record: result,
    });
  }

  if (name === 'get_customer_information' && result.found && result.customerId) {
    sources.set(`customer:${result.customerId}`, {
      type: 'customer',
      id: result.customerId,
      label: result.name ?? result.customerId,
      record: result,
    });
  }

  if (result?.order?.id) {
    sources.set(`order:${result.order.id}`, {
      type: 'order',
      id: result.order.id,
      label: result.order.orderNumber ?? result.order.id,
      record: result.order,
    });
  }

  if (result?.quote?.id) {
    sources.set(`quote:${result.quote.id}`, {
      type: 'quote',
      id: result.quote.id,
      label: `Quote version ${result.quote.version ?? '?'}`,
      record: result.quote,
    });
  }

  if (result?.preparation?.id) {
    sources.set(`preparation:${result.preparation.id}`, {
      type: 'preparation',
      id: result.preparation.id,
      label: `Order preparation ${result.preparation.id}`,
      record: result.preparation,
    });
  }

  if (name === 'ai_search_order_preparations' && Array.isArray(result.items)) {
    for (const item of result.items) {
      if (!item?.orderId) continue;
      sources.set(`order:${item.orderId}`, {
        type: 'order',
        id: item.orderId,
        label: item.orderNumber ?? item.orderId,
        record: item,
      });
    }
  }
}

async function resolveProductImageUrls(serviceClient, sourceRecords) {
  const products = sourceRecords
    .filter((source) => source.type === 'product')
    .map((source) => source.record);
  const paths = new Set();

  for (const product of products) {
    for (const image of Array.isArray(product?.images) ? product.images : []) {
      if (typeof image?.path === 'string' && image.path) paths.add(image.path);
    }
  }

  if (paths.size === 0) return;

  for (const path of paths) {
    const { data: isPublic, error: publicError } = await serviceClient.rpc(
      'is_public_product_image',
      { p_storage_path: path },
    );
    if (publicError || !isPublic) continue;

    const { data: signed, error: signedError } = await serviceClient.storage
      .from('product-images')
      .createSignedUrl(path, 3600);
    if (signedError || !signed?.signedUrl) continue;

    for (const product of products) {
      for (const image of Array.isArray(product.images) ? product.images : []) {
        if (image.path === path) image.url = signed.signedUrl;
      }
    }
  }
}

async function executeTool({
  name,
  args,
  businessId,
  context,
  userClient,
  serviceClient,
  sources,
  toolCalls,
}) {
  const validation = validateToolCall({ name, arguments: args });
  if (!validation.ok) {
    const result = { ok: false, error: validation.error };
    toolCalls.push({ name, arguments: args, result });
    return { ok: false, name, result };
  }

  const idempotencyContext = {
    ...context,
    idempotencyKey: `${context.requestId}:${context.commandIndex}:${validation.name}`.slice(0, 128),
  };
  const { data, error } = await userClient.rpc(
    validation.name,
    toolRpcArguments(validation.name, validation.value, businessId, idempotencyContext),
  );

  const result = error
    ? { ok: false, error: cleanError(error) }
    : unwrapRpc(data) ?? { ok: true };

  collectSourceRecords(validation.name, result, sources);
  toolCalls.push({ name: validation.name, arguments: validation.value, result });
  return { ok: !error, name: validation.name, result };
}

function toolMessage(toolCall, result) {
  const content = JSON.stringify(result).slice(0, TOOL_RESULT_LIMIT);
  return {
    role: 'tool',
    tool_call_id: toolCall.id || `tool-${toolCall.name}`,
    name: toolCall.name,
    content,
  };
}

async function completeRequest(serviceClient, requestId, payload) {
  if (!requestId) return;
  const { error } = await serviceClient.rpc('ai_complete_assistant_request', {
    p_request_id: requestId,
    p_status: payload.status,
    p_input_tokens: payload.inputTokens ?? 0,
    p_output_tokens: payload.outputTokens ?? 0,
    p_estimated_cost_usd: payload.estimatedCostUsd ?? null,
    p_latency_ms: payload.latencyMs ?? null,
    p_response: payload.response ?? null,
    p_tools_used: payload.toolsUsed ?? [],
    p_language: payload.language ?? null,
    p_error_code: payload.errorCode ?? null,
    p_error_message: payload.errorMessage ?? null,
  });
  if (error) console.error('[ai-assistant] usage update failed', cleanError(error));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 'Use POST for assistant requests.', 405);
  }

  const startedAt = Date.now();
  let requestId = null;
  let usageRequestId = null;
  let serviceClient = null;

  try {
    const supabaseUrl = env('SUPABASE_URL');
    const anonKey = env('SUPABASE_ANON_KEY');
    const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return errorResponse(
        request,
        'ASSISTANT_CONFIG_ERROR',
        'The assistant service is not configured.',
        503,
      );
    }

    const authenticated = await authenticateUser(request, supabaseUrl, anonKey);
    if (!authenticated) {
      return errorResponse(request, 'UNAUTHENTICATED', 'Sign in to use the assistant.', 401);
    }

    const { client: userClient, user } = authenticated;
    serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse(request, 'INVALID_REQUEST', 'The request body must be JSON.', 400);
    }

    if (!body || typeof body !== 'object') {
      return errorResponse(request, 'INVALID_REQUEST', 'The request body must be an object.', 400);
    }

    const businessId = String(body.businessId ?? '').trim();
    const message = String(body.message ?? '').trim();
    if (!isUuid(businessId)) {
      return errorResponse(request, 'INVALID_REQUEST', 'A valid businessId is required.', 400);
    }
    if (message.length < 1 || message.length > 4000) {
      return errorResponse(request, 'INVALID_REQUEST', 'Message must be between 1 and 4000 characters.', 400);
    }

    requestId = isUuid(body.requestId) ? String(body.requestId) : crypto.randomUUID();
    const conversationId = isUuid(body.conversationId) ? String(body.conversationId) : null;
    const historyLimit = clampInteger(body.historyLimit, 8, 1, 20);
    const requestedLanguage = SUPPORTED_LANGUAGES.includes(body.language)
      ? body.language
      : 'auto';

    const accessResult = await userClient.rpc('ai_get_assistant_access', {
      p_business_id: businessId,
    });
    const access = unwrapRpc(accessResult.data);
    if (accessResult.error || !access?.allowed) {
      return errorResponse(
        request,
        'FORBIDDEN',
        'You do not have access to this assistant.',
        403,
      );
    }
    if (!access.enabled) {
      return errorResponse(request, 'ASSISTANT_DISABLED', 'The assistant is disabled for this workspace.', 403);
    }

    const supportedLanguages = Array.isArray(access.supportedLanguages)
      ? access.supportedLanguages
      : ['en', 'rw', 'sw', 'fr'];
    if (requestedLanguage !== 'auto' && !supportedLanguages.includes(requestedLanguage)) {
      return errorResponse(request, 'UNSUPPORTED_LANGUAGE', 'That language is not enabled for this business.', 400);
    }

    const providerConfig = readProviderConfig();
    const provider = createAIProvider(providerConfig);
    const model = providerConfig.model || 'unconfigured';

    const beginResult = await userClient.rpc('ai_begin_assistant_request', {
      p_business_id: businessId,
      p_request_key: requestId,
      p_input_chars: message.length,
      p_model: model,
      p_provider: providerConfig.provider,
    });
    const begin = unwrapRpc(beginResult.data);
    if (beginResult.error || !begin) {
      return errorResponse(request, 'USAGE_CHECK_FAILED', 'The assistant request could not be started.', 500);
    }

    usageRequestId = begin.requestId ?? null;

    if (!begin.allowed && begin.reason === 'duplicate') {
      return jsonResponse(request, {
        ...(begin.response ?? {}),
        deduplicated: true,
        requestId,
      });
    }

    if (!begin.allowed && begin.reason === 'disabled') {
      return errorResponse(request, 'ASSISTANT_DISABLED', 'The assistant is disabled for this workspace.', 403);
    }

    if (!begin.allowed && begin.reason === 'rate_limited') {
      return errorResponse(
        request,
        'AI_RATE_LIMITED',
        'The workspace AI usage limit was reached.',
        429,
        {
          usedRequests: begin.usedRequests,
          usedTokens: begin.usedTokens,
          dailyRequestLimit: begin.dailyRequestLimit,
          dailyTokenLimit: begin.dailyTokenLimit,
        },
      );
    }

    const activeConversationId = conversationId
      ?? unwrapRpc((await userClient.rpc('ai_ensure_test_conversation', {
        p_business_id: businessId,
      })).data);

    if (!isUuid(activeConversationId)) {
      throw new Error('A conversation could not be created for this assistant session.');
    }

    const contextResult = await userClient.rpc('ai_get_conversation_context', {
      p_business_id: businessId,
      p_conversation_id: activeConversationId,
      p_limit: historyLimit,
    });
    const context = unwrapRpc(contextResult.data);
    if (contextResult.error || !context?.found) {
      return errorResponse(request, 'CONVERSATION_NOT_FOUND', 'The conversation was not found.', 404);
    }

    if (!context.aiMayRespond) {
      const handoverResponse = {
        answer: 'This conversation is with a human team member. The AI assistant will not respond until human handover is released.',
        language: resolveLanguage(requestedLanguage, context.languagePreference),
        needsClarification: false,
        sourceIds: [],
        handover: true,
        conversationId: activeConversationId,
        requestId,
        provider: providerConfig.provider,
        model,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
        toolsUsed: [],
        sources: [],
        toolCalls: [],
        generatedAt: new Date().toISOString(),
      };
      await completeRequest(serviceClient, usageRequestId, {
        status: 'completed',
        response: handoverResponse,
        language: handoverResponse.language,
        toolsUsed: [],
      });
      return jsonResponse(request, handoverResponse);
    }

    if (!isProviderConfigured(providerConfig)) {
      throw new AIProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'No AI provider is configured for this workspace.',
      );
    }

    const detection = detectLanguage(`${message} ${context.languagePreference ?? ''}`);
    const language = resolveLanguage(requestedLanguage, detection.language);
    const sources = new Map();
    const toolCalls = [];
    const toolContext = {
      conversationId: activeConversationId,
      message,
      requestId,
    };

    const history = Array.isArray(context.messages)
      ? context.messages
        .filter((item) => typeof item?.content === 'string' && item.content.trim())
        .slice(-historyLimit)
        .map((item) => ({ role: item.role === 'user' ? 'user' : 'assistant', content: item.content.slice(0, 4000) }))
      : [];

    const systemPrompt = buildSystemPrompt({
      businessName: access.businessName ?? 'OrderFlow',
      supportedLanguages,
      language,
      extraPrompt: access.systemPromptExtra ?? '',
    });

    const firstResponse = await provider.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ],
      tools: TOOL_DEFINITIONS,
      toolChoice: 'required',
      maxTokens: Math.min(begin.maxOutputTokens ?? 700, providerConfig.maxOutputTokens),
    });

    if (Array.isArray(firstResponse.toolCalls) && firstResponse.toolCalls.length > 0) {
      for (const [index, call] of firstResponse.toolCalls.slice(0, 5).entries()) {
        const outcome = await executeTool({
          name: call.name,
          args: call.arguments,
          businessId,
          context: { ...toolContext, commandIndex: index + 1 },
          userClient,
          serviceClient,
          sources,
          toolCalls,
        });
        call.execution = outcome;
      }
    } else {
      const outcomes = [
        await executeTool({
          name: 'get_business_information',
          args: {},
          businessId,
          context: { ...toolContext, commandIndex: 101 },
          userClient,
          serviceClient,
          sources,
          toolCalls,
        }),
        await executeTool({
          name: 'search_products',
          args: { query: message, limit: 8 },
          businessId,
          context: { ...toolContext, commandIndex: 102 },
          userClient,
          serviceClient,
          sources,
          toolCalls,
        }),
      ];
      outcomes.forEach((outcome, index) => {
        toolCalls[index].fallback = true;
      });
    }

    if (toolCalls.length === 0) {
      throw new Error('No verified tool results were available for the answer.');
    }

    const sourceRecords = Array.from(sources.values());
    await resolveProductImageUrls(serviceClient, sourceRecords);
    const allowedSourceIds = sourceRecords.map((source) => String(source.id));
    const toolPayload = toolCalls
      .filter((call) => call.execution || call.fallback)
      .map((call) => toolMessage(call, call.execution?.result ?? call.result));
    const assistantToolCalls = (firstResponse.toolCalls ?? []).map((call) => ({
      id: call.id || `tool-${call.name}`,
      type: 'function',
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments ?? {}),
      },
    }));
    const assistantToolMessage = assistantToolCalls.length > 0
      ? [{ role: 'assistant', content: '', tool_calls: assistantToolCalls }]
      : [];

    const finalResponse = await provider.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
        ...assistantToolMessage,
        ...toolPayload,
        {
          role: 'user',
          content: 'Use only the verified tool results above. Return the required JSON object.',
        },
      ],
      tools: [],
      maxTokens: Math.min(begin.maxOutputTokens ?? 700, providerConfig.maxOutputTokens),
    });

    const parsed = parseAssistantOutput(finalResponse.content, allowedSourceIds);
    const linkedSources = sourceRecords.filter((source) => parsed.sourceIds.includes(String(source.id)));
    const inputTokens = (firstResponse.usage?.inputTokens ?? 0) + (finalResponse.usage?.inputTokens ?? 0);
    const outputTokens = (firstResponse.usage?.outputTokens ?? 0) + (finalResponse.usage?.outputTokens ?? 0);
    const estimatedCostUsd = (() => {
      const firstCost = estimateCostUsd(providerConfig, firstResponse.usage ?? {});
      const finalCost = estimateCostUsd(providerConfig, finalResponse.usage ?? {});
      if (firstCost === null && finalCost === null) return null;
      return Number(((firstCost ?? 0) + (finalCost ?? 0)).toFixed(8));
    })();
    const latencyMs = Date.now() - startedAt;
    const orderToolCalls = toolCalls.filter((call) => ORDER_TOOL_NAMES.has(call.name));
    const latestOrderResult = [...orderToolCalls]
      .reverse()
      .map((call) => call.execution?.result ?? call.result)
      .find((result) => result?.order || Array.isArray(result?.items)) ?? null;
    const orderResult = latestOrderResult?.order ?? null;
    const preparationResult = latestOrderResult?.preparation ?? null;
    const quoteResult = latestOrderResult?.quote ?? null;

    const response = {
      answer: parsed.answer,
      language: parsed.language,
      detectedLanguage: detection.language,
      languageConfidence: detection.confidence,
      needsClarification: parsed.needsClarification,
      requestId,
      conversationId: activeConversationId,
      provider: providerConfig.provider,
      model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd,
        latencyMs,
      },
      toolsUsed: toolCalls.map((call) => call.name),
      toolCalls: toolCalls.map((call) => ({
        name: call.name,
        arguments: call.arguments ?? {},
        ok: call.execution ? call.execution.ok : true,
      })),
      sources: linkedSources,
      sourceIds: parsed.sourceIds,
      orderId: parsed.orderId ?? orderResult?.id ?? null,
      quoteId: parsed.quoteId ?? quoteResult?.id ?? null,
      orderStatus: parsed.orderStatus ?? orderResult?.status ?? null,
      preparationStatus: parsed.preparationStatus ?? preparationResult?.status ?? null,
      requiresCustomerConfirmation:
        parsed.requiresCustomerConfirmation
        || preparationResult?.status === 'awaiting_customer_confirmation',
      businessApprovalRequired:
        parsed.businessApprovalRequired
        || orderResult?.status === 'awaiting_business_approval',
      stockChanged: parsed.stockChanged || orderResult?.stockState === 'reserved',
      commerceAction: latestOrderResult
        ? {
          action: latestOrderResult.action ?? null,
          accepted: latestOrderResult.accepted ?? null,
          requiresReconfirmation: latestOrderResult.requiresReconfirmation ?? false,
          customerConfirmed: Boolean(orderResult?.customerConfirmedAt),
          businessApprovalRequired: orderResult?.status === 'awaiting_business_approval',
        }
        : null,
      generatedAt: new Date().toISOString(),
      readOnly: orderToolCalls.length === 0,
    };

    const turnResult = await userClient.rpc('ai_record_assistant_turn', {
      p_business_id: businessId,
      p_conversation_id: activeConversationId,
      p_user_message: message,
      p_assistant_message: response.answer,
      p_sources: linkedSources,
      p_usage: response.usage,
      p_language: response.language,
      p_request_id: requestId,
    });
    if (turnResult.error) console.error('[ai-assistant] turn save failed', cleanError(turnResult.error));

    await completeRequest(serviceClient, usageRequestId, {
      status: 'completed',
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      latencyMs,
      response,
      toolsUsed: response.toolsUsed,
      language: response.language,
    });

    return jsonResponse(request, response);
  } catch (error) {
    const providerError = error instanceof AIProviderError ? error : null;
    const code = providerError?.code ?? 'INTERNAL_ERROR';
    const message = providerError?.message
      ?? 'The assistant request could not be completed.';
    console.error(`[ai-assistant] ${requestId ?? 'unknown'} ${code}`, cleanError(error));

    if (usageRequestId && serviceClient) {
      await completeRequest(serviceClient, usageRequestId, {
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        errorCode: code,
        errorMessage: message,
      });
    }

    const status = code === 'PROVIDER_RATE_LIMITED'
      ? 429
      : code === 'PROVIDER_TIMEOUT'
        ? 504
        : code === 'PROVIDER_NOT_CONFIGURED' || code === 'PROVIDER_CONFIGURATION_ERROR'
          ? 503
          : code === 'PROVIDER_UNSUPPORTED' || code === 'PROVIDER_INVALID_RESPONSE'
            ? 502
            : 500;

    return errorResponse(request, code, message, status);
  }
});
