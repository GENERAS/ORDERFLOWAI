import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Inbox,
  Loader2,
  MessageCircle,
  Search,
  Send,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { controlClasses } from '../../components/ui/formStyles';
import {
  assignConversation,
  downloadMedia,
  getConversation,
  getSendContext,
  listAssignableUsers,
  listBusinessImages,
  listChannels,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  setConversationStatus,
  setOptOut,
  toCommunicationServiceError,
} from '../../services/communicationService';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';

const MANAGER_ROLES = ['owner', 'admin', 'manager'];
const PAGE_SIZE = 50;

function isChannelConnected(channel) {
  return Boolean(
    channel?.isConnected ?? ['connected', 'active'].includes(channel?.status),
  );
}

function conversationStatusVariant(status) {
  if (status === 'open') return 'brand';
  if (status === 'pending' || status === 'assigned') return 'warning';
  if (status === 'resolved' || status === 'closed') return 'success';
  return 'neutral';
}

function deliveryMeta(message) {
  if (message.errorMessage) return { label: 'Failed', variant: 'danger' };
  const status = String(message.deliveryStatus ?? '').toLowerCase();
  if (['sent', 'delivered', 'read', 'received'].includes(status)) {
    return { label: status.charAt(0).toUpperCase() + status.slice(1), variant: 'success' };
  }
  if (['failed', 'error'].includes(status)) return { label: 'Failed', variant: 'danger' };
  if (['pending', 'queued'].includes(status)) return { label: 'Pending', variant: 'warning' };
  return null;
}

function formatListTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-RW', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function mergeConversation(current, updated) {
  if (!updated || typeof updated !== 'object') return current;
  return { ...current, ...updated };
}

export default function InboxPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const canManage = MANAGER_ROLES.includes(activeMembership?.role);

  const [channels, setChannels] = useState([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [oldestCursor, setOldestCursor] = useState(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [sendContext, setSendContext] = useState(null);
  const [images, setImages] = useState([]);
  const [composer, setComposer] = useState({
    text: '',
    mediaAssetId: '',
    templateName: '',
    templateLanguage: 'en',
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const detailRequestRef = useRef(0);

  const whatsappChannel = channels.find((channel) => channel.channel === 'whatsapp');
  const hasConnectedWhatsapp = Boolean(
    whatsappChannel && isChannelConnected(whatsappChannel),
  );

  const statusOptions = useMemo(() => {
    const values = new Set(['open', 'pending', 'assigned', 'resolved', 'archived']);
    if (conversation?.status) values.add(conversation.status);
    for (const item of conversations) {
      if (item.status) values.add(item.status);
    }
    return Array.from(values).map((value) => ({
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
    }));
  }, [conversation, conversations]);

  const imageOptions = useMemo(
    () =>
      images.map((image) => ({
        value: image.id,
        label: image.originalFilename,
      })),
    [images],
  );

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    listChannels(businessId)
      .then((result) => {
        if (!active) return;
        setChannels(result);
      })
      .catch((loadError) => {
        if (active) setError(toCommunicationServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setChannelsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const loadConversations = useCallback(async () => {
    setConversationsLoading(true);
    if (!businessId || !hasConnectedWhatsapp) {
      setConversations([]);
      setConversationsLoading(false);
      return;
    }

    try {
      const result = await listConversations(businessId, {
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
      });
      setConversations(result);
    } catch (loadError) {
      setError(toCommunicationServiceError(loadError).message);
    } finally {
      setConversationsLoading(false);
    }
  }, [businessId, debouncedSearch, hasConnectedWhatsapp, statusFilter]);

  useEffect(() => {
    void Promise.resolve().then(loadConversations);
  }, [loadConversations]);

  const loadConversation = useCallback(
    async (conversationId) => {
      if (!businessId || !conversationId) return;

      const requestId = ++detailRequestRef.current;
      setDetailLoading(true);
      setError('');

      try {
        const [nextConversation, history, users, context, businessImages] =
          await Promise.all([
            getConversation(conversationId),
            listMessages(conversationId, { limit: PAGE_SIZE }),
            listAssignableUsers(businessId),
            getSendContext(conversationId),
            listBusinessImages(businessId, 60).catch(() => []),
          ]);

        if (requestId !== detailRequestRef.current) return;

        setConversation(nextConversation);
        setMessages(history);
        setOldestCursor(history[0]?.createdAt ?? null);
        setHasMoreMessages(
          history.some((message) => message.hasMore) || history.length === PAGE_SIZE,
        );
        setAssignableUsers(users);
        setSendContext(context);
        setImages(businessImages);
      } catch (loadError) {
        if (requestId !== detailRequestRef.current) return;
        setError(toCommunicationServiceError(loadError).message);
      } finally {
        if (requestId === detailRequestRef.current) setDetailLoading(false);
      }
    },
    [businessId],
  );

  const handleSelectConversation = async (conversationId) => {
    if (conversationId === selectedId) return;

    setSelectedId(conversationId);
    setConversation(null);
    setMessages([]);
    setOldestCursor(null);
    setSendContext(null);
    setDownloadError('');
    setSuccess('');
    setComposer({
      text: '',
      mediaAssetId: '',
      templateName: '',
      templateLanguage: 'en',
    });

    try {
      await markConversationRead(conversationId);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId ? { ...item, unreadCount: 0 } : item,
        ),
      );
    } catch (readError) {
      setError(toCommunicationServiceError(readError).message);
    }

    loadConversation(conversationId);
  };

  const loadOlderMessages = async () => {
    if (!selectedId || !oldestCursor || olderLoading) return;

    setOlderLoading(true);
    try {
      const older = await listMessages(selectedId, {
        before: oldestCursor,
        limit: PAGE_SIZE,
      });
      setMessages((current) => {
        const seen = new Set(current.map((message) => message.id));
        const unique = older.filter((message) => !seen.has(message.id));
        return [...unique, ...current];
      });
      if (older.length > 0) setOldestCursor(older[0].createdAt);
      setHasMoreMessages(
        older.length > 0 &&
          (older.some((message) => message.hasMore) || older.length === PAGE_SIZE),
      );
    } catch (loadError) {
      setError(toCommunicationServiceError(loadError).message);
    } finally {
      setOlderLoading(false);
    }
  };

  const handleDownload = async (message) => {
    if (!businessId || !message?.id) return;

    setDownloadError('');
    try {
      const blob = await downloadMedia({ businessId, messageId: message.id });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = message.mediaFilename ?? `message-${message.id}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (downloadFailure) {
      setDownloadError(toCommunicationServiceError(downloadFailure).message);
    }
  };

  const handleAssign = async (event) => {
    if (!selectedId) return;
    const assigneeId = event.target.value || null;

    try {
      await assignConversation(selectedId, assigneeId);
      const patch = {
        assigneeId,
        assigneeName:
          assignableUsers.find((user) => user.id === assigneeId)?.fullName ?? null,
        status: assigneeId ? 'assigned' : 'open',
      };
      setConversation((current) => mergeConversation(current, patch));
      setConversations((current) =>
        current.map((item) =>
          item.id === selectedId ? mergeConversation(item, patch) : item,
        ),
      );
    } catch (updateError) {
      setError(toCommunicationServiceError(updateError).message);
    }
  };

  const handleStatusChange = async (event) => {
    if (!selectedId) return;
    const status = event.target.value;
    if (!status) return;

    try {
      await setConversationStatus(selectedId, status);
      const patch = { status };
      setConversation((current) => mergeConversation(current, patch));
      setConversations((current) =>
        current.map((item) =>
          item.id === selectedId ? mergeConversation(item, patch) : item,
        ),
      );
    } catch (updateError) {
      setError(toCommunicationServiceError(updateError).message);
    }
  };

  const handleOptOut = async () => {
    if (!selectedId || !conversation?.externalCustomerId) return;
    const optedOut = !conversation.optedOut;
    const confirmed = window.confirm(
      optedOut
        ? 'Stop outbound messages to this customer?'
        : 'Allow outbound messages to this customer again?',
    );
    if (!confirmed) return;

    try {
      await setOptOut(
        businessId,
        conversation.externalCustomerId,
        optedOut,
        'Updated from shared inbox',
      );
      setConversation((current) => mergeConversation(current, { optedOut }));
      setSendContext((current) => ({
        ...current,
        optedOut,
        canSend: Boolean(current?.canSend) && !optedOut,
      }));
    } catch (updateError) {
      setError(toCommunicationServiceError(updateError).message);
    }
  };

  const optOutActive = Boolean(sendContext?.optedOut || conversation?.optedOut);
  const connectionInactive = !hasConnectedWhatsapp;
  const canSend = Boolean(
    selectedId &&
      !connectionInactive &&
      !optOutActive &&
      sendContext?.canSend !== false &&
      !sending &&
      (sendContext?.templateRequired
        ? composer.templateName.trim().length > 0
        : composer.mediaAssetId || composer.text.trim()),
  );

  const handleSend = async () => {
    if (!canSend || !selectedId) return;

    setSending(true);
    setError('');
    setSuccess('');

    try {
      const messageType = composer.mediaAssetId ? 'image' : 'text';

      await sendMessage({
        businessId,
        conversationId: selectedId,
        messageType,
        text: composer.text,
        mediaAssetId: composer.mediaAssetId || null,
        templateName: composer.templateName.trim() || null,
        templateLanguage: composer.templateLanguage.trim() || null,
      });

      setComposer({
        text: '',
        mediaAssetId: '',
        templateName: '',
        templateLanguage: 'en',
      });
      setSuccess('Message sent.');
      await Promise.all([loadConversation(selectedId), loadConversations()]);
    } catch (sendFailure) {
      setError(toCommunicationServiceError(sendFailure).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="inbox-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="inbox-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Shared inbox
            </h2>
            <Badge variant="brand">Live conversations</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Reply to real WhatsApp conversations, see customer context and keep
            ownership clear across your team.
          </p>
        </div>
        <Link
          to="/channels"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-50"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Channels
        </Link>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}
      {downloadError ? <Alert variant="error">{downloadError}</Alert> : null}

      {channelsLoading ? (
        <Card className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading channels...
        </Card>
      ) : null}

      {!channelsLoading && !hasConnectedWhatsapp ? (
        <EmptyState
          icon={Inbox}
          title="No connected WhatsApp channel"
          description="Connect WhatsApp in Communication channels before using the shared inbox. Conversations are only shown for connected channels."
          action={
            <Link
              to="/channels"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Set up WhatsApp
            </Link>
          }
        />
      ) : null}

      {!channelsLoading && hasConnectedWhatsapp ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)] xl:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)_minmax(240px,1fr)]">
          <Card className="flex min-h-[420px] flex-col overflow-hidden">
            <CardHeader className="flex-col gap-3 border-b border-slate-100 px-4 pb-4">
              <div className="flex w-full items-center justify-between gap-2">
                <CardTitle>Conversations</CardTitle>
                {conversationsLoading ? (
                  <Loader2
                    className="h-4 w-4 animate-spin text-slate-400"
                    aria-label="Loading conversations"
                  />
                ) : null}
              </div>
              <div className="grid w-full gap-2">
                <FormField
                  id="inbox-search"
                  type="search"
                  label="Search"
                  placeholder="Name or phone number"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  trailing={<Search className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                />
                <SelectField
                  id="inbox-status-filter"
                  label="Status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  options={statusOptions}
                  placeholder="All statuses"
                />
              </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-2 p-2">
              {!conversationsLoading && conversations.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-slate-500">
                  No conversations match the current filters.
                </p>
              ) : null}
              {conversations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectConversation(item.id)}
                  aria-current={selectedId === item.id ? 'true' : undefined}
                  aria-label={`Open conversation with ${item.displayName}`}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedId === item.id
                      ? 'border-brand-200 bg-brand-50'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.displayName}
                    </p>
                    <Badge variant={conversationStatusVariant(item.status)}>
                      {item.status ?? 'open'}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                    {item.lastMessagePreview ?? 'No messages yet'}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span>{formatListTime(item.lastMessageAt)}</span>
                    {item.unreadCount > 0 ? (
                      <Badge variant="danger">{item.unreadCount} unread</Badge>
                    ) : null}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="flex min-h-[520px] flex-col overflow-hidden">
            <CardHeader className="flex-col gap-3 border-b border-slate-100 px-4 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="truncate">
                  {conversation?.displayName ?? 'Select a conversation'}
                </CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {conversation?.assigneeName
                    ? `Assigned to ${conversation.assigneeName}`
                    : 'Unassigned'}
                </p>
              </div>
              {conversation ? (
                <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                  <SelectField
                    id="inbox-assignee"
                    label="Assignee"
                    value={conversation.assigneeId ?? ''}
                    onChange={handleAssign}
                    disabled={!canManage}
                    options={assignableUsers.map((user) => ({
                      value: user.id,
                      label: user.fullName,
                    }))}
                    placeholder="Unassigned"
                  />
                  <SelectField
                    id="inbox-conversation-status"
                    label="Status"
                    value={conversation.status ?? 'open'}
                    onChange={handleStatusChange}
                    disabled={!canManage}
                    options={statusOptions}
                  />
                </div>
              ) : null}
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-3 p-4">
              {!selectedId ? (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    icon={MessageCircle}
                    title="Choose a conversation"
                    description="Select a conversation to read its history and reply to the customer."
                  />
                </div>
              ) : null}

              {selectedId && detailLoading ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading conversation...
                </div>
              ) : null}

              {selectedId && !detailLoading ? (
                <>
                  <div className="flex-1 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-3">
                    {hasMoreMessages ? (
                      <div className="flex justify-center">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={loadOlderMessages}
                          disabled={olderLoading || !oldestCursor}
                        >
                          {olderLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : null}
                          Load older messages
                        </Button>
                      </div>
                    ) : null}

                    {messages.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500">
                        No messages in this conversation yet.
                      </p>
                    ) : null}

                    {messages.map((message) => {
                      const outbound = message.direction === 'outbound';
                      const delivery = deliveryMeta(message);
                      const hasMedia = Boolean(
                        message.mediaAssetId ||
                          message.mediaProviderId ||
                          message.mediaUrl ||
                          message.mediaMimeType,
                      );
                      const canDownload = Boolean(
                        message.mediaProviderId || message.mediaAssetId,
                      );

                      return (
                        <article
                          key={message.id}
                          className={`flex flex-col ${outbound ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[75%] ${
                              outbound
                                ? 'bg-brand-600 text-white'
                                : 'bg-white text-slate-800 ring-1 ring-inset ring-slate-200'
                            }`}
                          >
                            {message.text ? (
                              <p className="whitespace-pre-wrap break-words">{message.text}</p>
                            ) : null}
                            {hasMedia ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Badge
                                  variant={outbound ? 'neutral' : 'brand'}
                                  className={outbound ? 'bg-white/15 text-white ring-white/30' : ''}
                                >
                                  {message.messageType === 'image' ? 'Image' : 'Media'}
                                </Badge>
                                {canDownload ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDownload(message)}
                                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                                  >
                                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                                    Download
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                            <span>{formatListTime(message.createdAt)}</span>
                            {delivery ? (
                              <Badge variant={delivery.variant}>{delivery.label}</Badge>
                            ) : null}
                            {message.errorMessage ? (
                              <span className="text-red-600">{message.errorMessage}</span>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    {connectionInactive ? (
                      <Alert variant="warning">
                        WhatsApp is not connected. Reconnect it in Communication channels
                        before sending.
                      </Alert>
                    ) : null}
                    {optOutActive ? (
                      <Alert variant="warning" title="Customer opted out">
                        This customer opted out of messages. Sending is disabled until the
                        opt-out is removed.
                      </Alert>
                    ) : null}
                    {sendContext?.reason && !optOutActive ? (
                      <Alert variant="info">{sendContext.reason}</Alert>
                    ) : null}

                    <div>
                      <label htmlFor="inbox-message" className="block text-sm font-medium text-slate-700">
                        Message
                      </label>
                      <textarea
                        id="inbox-message"
                        rows={3}
                        className={`${controlClasses} mt-1.5 resize-y`}
                        placeholder={
                          sendContext?.templateRequired
                            ? 'Optional text for this template message'
                            : 'Write a reply...'
                        }
                        value={composer.text}
                        onChange={(event) =>
                          setComposer((current) => ({
                            ...current,
                            text: event.target.value,
                          }))
                        }
                        disabled={sending}
                        aria-describedby="inbox-message-hint"
                      />
                      <p id="inbox-message-hint" className="mt-1 text-xs text-slate-500">
                        Messages are sent through the connected WhatsApp account only.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <SelectField
                        id="inbox-image"
                        label="Attach business image"
                        value={composer.mediaAssetId}
                        onChange={(event) =>
                          setComposer((current) => ({
                            ...current,
                            mediaAssetId: event.target.value,
                          }))
                        }
                        options={imageOptions}
                        placeholder="No image attached"
                        disabled={sendContext?.templateRequired}
                      />
                      {sendContext?.templateRequired ? (
                        <>
                          <FormField
                            id="inbox-template-name"
                            label="Approved template"
                            value={composer.templateName}
                            onChange={(event) =>
                              setComposer((current) => ({
                                ...current,
                                templateName: event.target.value,
                              }))
                            }
                            placeholder="Template name"
                            required
                          />
                          <FormField
                            id="inbox-template-language"
                            label="Template language"
                            value={composer.templateLanguage}
                            onChange={(event) =>
                              setComposer((current) => ({
                                ...current,
                                templateLanguage: event.target.value,
                              }))
                            }
                            placeholder="en"
                          />
                        </>
                      ) : null}
                    </div>

                    <div className="flex justify-end">
                      <Button onClick={handleSend} disabled={!canSend}>
                        {sending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="h-4 w-4" aria-hidden="true" />
                        )}
                        {sending ? 'Sending...' : 'Send message'}
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 xl:col-span-1">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Customer context
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!conversation ? (
                <p className="text-sm text-slate-500">
                  Select a conversation to see customer details.
                </p>
              ) : null}

              {conversation?.customer ? (
                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-slate-900">
                    {conversation.customer.fullName ?? 'Unnamed customer'}
                  </p>
                  {conversation.customer.companyName ? (
                    <p className="text-slate-500">{conversation.customer.companyName}</p>
                  ) : null}
                  {conversation.customer.phone ? (
                    <a
                      href={`tel:${conversation.customer.phone.replace(/\s+/g, '')}`}
                      className="block break-all text-slate-600 hover:text-brand-700"
                    >
                      {conversation.customer.phone}
                    </a>
                  ) : null}
                  {conversation.customer.email ? (
                    <a
                      href={`mailto:${conversation.customer.email}`}
                      className="block break-all text-slate-600 hover:text-brand-700"
                    >
                      {conversation.customer.email}
                    </a>
                  ) : null}
                  {conversation.customer.id ? (
                    <Link
                      to={`/customers/${conversation.customer.id}`}
                      className="inline-block pt-1 text-xs font-medium text-brand-700 hover:underline"
                    >
                      View customer record
                    </Link>
                  ) : null}
                </div>
              ) : conversation ? (
                <p className="text-sm text-slate-500">
                  No customer record is linked to this conversation.
                </p>
              ) : null}

              {conversation?.externalCustomerId ? (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">WhatsApp customer</p>
                    <Badge variant={optOutActive ? 'warning' : 'success'}>
                      {optOutActive ? 'Opted out' : 'Opt-ins active'}
                    </Badge>
                  </div>
                  <p className="break-all font-mono text-xs text-slate-700">
                    {conversation.externalCustomerId}
                  </p>
                  {canManage ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleOptOut}
                    >
                      {optOutActive ? 'Remove opt-out' : 'Mark opted out'}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <div className="border-t border-slate-100 pt-3">
                <h3 className="text-sm font-semibold text-slate-900">Customer orders</h3>
                {conversation?.customerOrders?.length ? (
                  <div className="mt-2 space-y-3">
                    {conversation.customerOrders.map((order) => (
                      <Link
                        key={order.id}
                        to={`/orders/${order.id}`}
                        className="block rounded-lg border border-slate-200 p-3 transition-colors hover:border-brand-200 hover:bg-brand-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-800">
                            {order.orderNumber ?? 'Order'}
                          </span>
                          <Badge variant={conversationStatusVariant(order.status)}>
                            {order.status ?? 'pending'}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{formatCurrency(order.totalAmount, { currency: order.currency })}</span>
                          <span>{formatDateTime(order.createdAt)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No orders are linked to this customer.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
