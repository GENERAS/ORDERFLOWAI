import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ExternalLink,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/SelectField';
import {
  askAIAssistant,
  getAIAssistantErrorMessage,
} from '../../services/aiAssistantService';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'rw', label: 'Kinyarwanda' },
  { value: 'sw', label: 'Swahili' },
  { value: 'fr', label: 'French' },
];

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sourceLabel(source) {
  if (source.type === 'product') return source.record?.name ?? source.label;
  if (source.type === 'policy') return source.label;
  if (source.type === 'business') return 'Business information';
  if (source.type === 'order') return `Order ${source.id}`;
  if (source.type === 'quote') return `Quote ${source.id}`;
  if (source.type === 'preparation') return 'Order preparation';
  if (source.type === 'customer') return source.record?.name ?? 'Customer';
  return source.label;
}

function SourceCard({ source }) {
  const image = Array.isArray(source.record?.images)
    ? source.record.images.find((item) => item.url) ?? source.record.images[0]
    : null;
  const product = source.type === 'product' ? source.record : null;

  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
      {image?.url ? (
        <img
          src={image.url}
          alt={image.alt ?? sourceLabel(source)}
          className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-slate-200"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{sourceLabel(source)}</p>
        {product?.price !== undefined && product?.price !== null ? (
          <p className="text-xs text-slate-500">
            {formatCurrency(product.price, { currency: product.currency ?? 'RWF' })}
            {product.priceFrom ? ' from' : ''}
          </p>
        ) : null}
        {product?.availability ? (
          <p className="text-xs text-slate-400">{String(product.availability).replace('_', ' ')}</p>
        ) : null}
        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{source.id}</p>
      </div>
      {source.type === 'product' ? (
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
      ) : null}
    </div>
  );
}

function AssistantMessage({ message }) {
  const isAssistant = message.role === 'assistant';
  const Icon = isAssistant ? Bot : UserRound;

  return (
    <div className={`flex gap-3 ${isAssistant ? '' : 'flex-row-reverse'}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div
        className={`max-w-[min(100%,42rem)] space-y-3 rounded-xl px-4 py-3 text-sm ${
          isAssistant
            ? 'border border-slate-200 bg-white text-slate-700'
            : 'bg-brand-600 text-white'
        }`}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
        {isAssistant && message.sources?.length > 0 ? (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Verified sources
            </p>
            {message.sources.map((source) => (
              <SourceCard key={`${source.type}:${source.id}`} source={source} />
            ))}
          </div>
        ) : null}
        {isAssistant && (message.orderId || message.quoteId) ? (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Order preparation
            </p>
            <div className="flex flex-wrap gap-2">
              {message.orderId ? (
                <Badge variant="brand">Draft {message.orderId.slice(0, 8)}</Badge>
              ) : null}
              {message.quoteId ? (
                <Badge variant="neutral">Quote {message.quoteId.slice(0, 8)}</Badge>
              ) : null}
              {message.orderStatus ? (
                <Badge variant="neutral">{message.orderStatus.replaceAll('_', ' ')}</Badge>
              ) : null}
              {message.preparationStatus ? (
                <Badge variant="neutral">{message.preparationStatus.replaceAll('_', ' ')}</Badge>
              ) : null}
              {message.requiresCustomerConfirmation ? (
                <Badge variant="warning">Customer review required</Badge>
              ) : null}
              {message.businessApprovalRequired ? (
                <Badge variant="warning">Business approval required</Badge>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-400">
              {message.stockChanged
                ? 'Backend stock state changed.'
                : 'No stock was reserved or consumed by this assistant.'}
            </p>
          </div>
        ) : null}
        {isAssistant && message.usage ? (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
            <Badge variant="neutral">{message.provider}</Badge>
            <Badge variant="neutral">{message.model}</Badge>
            <span>{message.usage.totalTokens ?? 0} tokens</span>
            <span>{message.usage.latencyMs ?? 0} ms</span>
          </div>
        ) : null}
        <p className={`text-[11px] ${isAssistant ? 'text-slate-400' : 'text-brand-100'}`}>
          {formatDateTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

export default function AssistantPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState('auto');
  const [conversationId, setConversationId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(null);

  const hasWorkspace = Boolean(businessId && activeMembership);
  const canSend = hasWorkspace && input.trim().length > 0 && !submitting;
  const status = useMemo(
    () => (
      submitting
        ? 'Working with verified business data...'
        : 'Draft-only assistant - customer confirmation and business approval still required'
    ),
    [submitting],
  );

  const resetSession = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setInput('');
    setError('');
    requestIdRef.current = null;
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSend) return;

    const userText = input.trim();
    const localRequestId = createId();
    requestIdRef.current = localRequestId;

    setMessages((current) => [
      ...current,
      { id: createId(), role: 'user', text: userText, createdAt: new Date().toISOString() },
    ]);
    setInput('');
    setError('');
    setSubmitting(true);

    try {
      const result = await askAIAssistant({
        businessId,
        message: userText,
        language,
        conversationId,
        requestId: localRequestId,
      });

      setConversationId(result.conversationId ?? conversationId);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          text: result.answer,
          createdAt: result.generatedAt ?? new Date().toISOString(),
          sources: Array.isArray(result.sources) ? result.sources : [],
          usage: result.usage,
          provider: result.provider,
          model: result.model,
          handover: result.handover,
          orderId: result.orderId,
          quoteId: result.quoteId,
          orderStatus: result.orderStatus,
          preparationStatus: result.preparationStatus,
          requiresCustomerConfirmation: result.requiresCustomerConfirmation,
          businessApprovalRequired: result.businessApprovalRequired,
          stockChanged: result.stockChanged,
        },
      ]);
    } catch (assistantError) {
      setError(getAIAssistantErrorMessage(assistantError));
    } finally {
      setSubmitting(false);
      requestIdRef.current = null;
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="assistant-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="assistant-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              AI commerce assistant
            </h2>
            <Badge variant="brand">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Draft-only
            </Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Ask about real products, prices, availability, policies and order status. The assistant
            can prepare order drafts and present quotes, but a customer must confirm explicitly and
            the business must approve before any stock is reserved.
          </p>
        </div>
        <Button variant="secondary" onClick={resetSession} disabled={submitting}>
          New session
        </Button>
      </div>

      {!hasWorkspace ? (
        <Alert variant="warning">
          Select or create a workspace before using the assistant.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="min-h-[32rem]">
          <CardHeader>
            <div>
              <CardTitle as="h2">Conversation</CardTitle>
              <CardDescription aria-live="polite">{status}</CardDescription>
            </div>
            {conversationId ? (
              <Badge variant="neutral">Shared inbox session</Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {messages.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Ask a product or order question"
                description="Try “What products do you have under 20,000 RWF?”, “Prepare a draft for two of them”, or “Do you have stock?” Drafts always need confirmation and approval."
              />
            ) : (
              <div className="space-y-5" aria-live="polite">
                {messages.map((message) => (
                  <AssistantMessage key={message.id} message={message} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle as="h2">Ask</CardTitle>
                <CardDescription>No account keys are exposed to the browser.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label
                    htmlFor="assistant-message"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Message
                  </label>
                  <textarea
                    id="assistant-message"
                    rows={6}
                    maxLength={4000}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Ask about catalogue, stock, policies or an order..."
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <SelectField
                  id="assistant-language"
                  label="Reply language"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  options={LANGUAGE_OPTIONS}
                  placeholder="Auto-detect"
                />
                <Button type="submit" className="w-full" disabled={!canSend}>
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                  {submitting ? 'Thinking...' : 'Send message'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle as="h2">Safety boundaries</CardTitle>
                <CardDescription>What this assistant will not do.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-slate-500">
                <li>Approve orders or record customer confirmation without explicit words</li>
                <li>Reserve, release or consume stock</li>
                <li>Record payments, refunds or deliveries</li>
                <li>Change stock, catalogue or policy records</li>
                <li>Answer from data outside this workspace</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
