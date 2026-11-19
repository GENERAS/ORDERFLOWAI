import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { env } from '../../lib/env';
import { getSupabaseClient } from '../../lib/supabase/client';
import {
  fetchMemberships,
  fetchPlatformContext,
  fetchProfile,
  signOut as signOutRequest,
  toAuthServiceError,
} from '../../services/authService';
import { fetchPlatformSupportSessions } from '../platform/platformService';
import { AuthContext } from './authContext';

const ACTIVE_BUSINESS_STORAGE_KEY = 'orderflow.activeBusinessId';

const EMPTY_PLATFORM = Object.freeze({
  isSuperAdmin: false,
  isPlatformAdmin: false,
  permissions: [],
  roles: [],
  supportBusinessIds: [],
});

const EMPTY_STATE = Object.freeze({
  status: 'loading',
  session: null,
  user: null,
  profile: null,
  memberships: [],
  activeBusinessId: null,
  platform: EMPTY_PLATFORM,
  error: null,
});

function readStoredActiveBusinessId() {
  try {
    return window.localStorage.getItem(ACTIVE_BUSINESS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeActiveBusinessId(businessId) {
  try {
    if (businessId) {
      window.localStorage.setItem(ACTIVE_BUSINESS_STORAGE_KEY, businessId);
    } else {
      window.localStorage.removeItem(ACTIVE_BUSINESS_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in private browsing; selection still works in memory.
  }
}

function readSupportActivationParam() {
  try {
    const value = new URLSearchParams(window.location.search).get('support');
    return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function resolveActiveBusinessId(memberships) {
  const supportParam = readSupportActivationParam();
  if (supportParam) {
    const supportMembership = memberships.find(
      (membership) =>
        membership.isSupportSession &&
        (membership.supportSessionId === supportParam ||
          membership.business.id === supportParam),
    );
    if (supportMembership) return supportMembership.business.id;
  }

  if (memberships.length === 1) {
    return memberships[0].business.id;
  }

  const stored = readStoredActiveBusinessId();
  if (stored && memberships.some((membership) => membership.business.id === stored)) {
    return stored;
  }

  return null;
}

function mapSupportSessionMembership(session) {
  const business = {
    id: session.business_id,
    name: session.business_name,
    slug: session.business_slug,
    industry: session.business_industry ?? null,
    country: session.business_country,
    currency: session.business_currency,
    timezone: session.business_timezone,
    createdAt: session.business_created_at,
    updatedAt: session.business_updated_at,
  };

  return {
    id: `support:${session.id}`,
    businessId: session.business_id,
    userId: session.actor_user_id,
    role: session.business_roles?.[0] ?? 'platform_support',
    status: 'active',
    createdAt: session.started_at,
    isSupportSession: true,
    supportSessionId: session.id,
    supportExpiresAt: session.expires_at,
    business,
  };
}

function mergeSupportSessionMemberships(memberships, supportSessions) {
  const byBusinessId = new Map(
    memberships.map((membership) => [membership.business.id, membership]),
  );

  supportSessions.forEach((session) => {
    const supportMembership = mapSupportSessionMembership(session);
    const existing = byBusinessId.get(supportMembership.business.id);
    byBusinessId.set(
      supportMembership.business.id,
      existing
        ? {
            ...existing,
            isSupportSession: true,
            supportSessionId: session.id,
            supportExpiresAt: session.expires_at,
            business: { ...supportMembership.business, ...existing.business },
          }
        : supportMembership,
    );
  });

  return [...byBusinessId.values()];
}

async function loadMemberships(userId) {
  const [memberships, supportSessions] = await Promise.all([
    fetchMemberships(userId),
    fetchPlatformSupportSessions().catch(() => []),
  ]);
  return mergeSupportSessionMemberships(memberships, supportSessions);
}

function signedOutState(error = null) {
  return { ...EMPTY_STATE, status: 'unauthenticated', error };
}

function errorState(error) {
  return { ...EMPTY_STATE, status: 'error', error };
}

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState(EMPTY_STATE);
  const currentUserIdRef = useRef(null);
  const hydratedRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadWorkspaceData = useCallback(async (session, { force = false } = {}) => {
    const requestId = ++requestIdRef.current;

    if (!session?.user) {
      currentUserIdRef.current = null;
      hydratedRef.current = false;
      storeActiveBusinessId(null);
      setAuthState(signedOutState());
      return;
    }

    const userId = session.user.id;
    const sameUser = currentUserIdRef.current === userId && hydratedRef.current;

    if (sameUser && !force) {
      setAuthState((previous) =>
        previous.user?.id === userId
          ? {
              ...previous,
              status: 'authenticated',
              session,
              user: session.user,
              error: null,
            }
          : previous,
      );
      return;
    }

    setAuthState((previous) =>
      sameUser
        ? {
            ...previous,
            status: 'loading',
            session,
            user: session.user,
            error: null,
          }
        : {
            ...EMPTY_STATE,
            status: 'loading',
            session,
            user: session.user,
          },
    );

    try {
      const [profile, memberships, platform] = await Promise.all([
        fetchProfile(userId),
        loadMemberships(userId),
        fetchPlatformContext(),
      ]);

      if (requestId !== requestIdRef.current) return;

      const activeBusinessId = resolveActiveBusinessId(memberships);
      storeActiveBusinessId(activeBusinessId);
      currentUserIdRef.current = userId;
      hydratedRef.current = true;

      setAuthState({
        status: 'authenticated',
        session,
        user: session.user,
        profile,
        memberships,
        activeBusinessId,
        platform,
        error: null,
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setAuthState((previous) => ({
        ...previous,
        status: 'error',
        session,
        user: session.user,
        error: toAuthServiceError(error).message,
      }));
    }
  }, []);

  useEffect(() => {
    let active = true;
    let subscription;
    let supabase;

    if (!env.isSupabaseConfigured) {
      setAuthState(
        signedOutState(
          'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local and restart the dev server.',
        ),
      );
      return undefined;
    }

    try {
      supabase = getSupabaseClient();
    } catch (error) {
      setAuthState(errorState(toAuthServiceError(error).message));
      return undefined;
    }

    async function initialize() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) {
          setAuthState(errorState(toAuthServiceError(error).message));
          return;
        }
        await loadWorkspaceData(data.session);
      } catch (error) {
        if (active) setAuthState(errorState(toAuthServiceError(error).message));
      }
    }

    initialize();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (event === 'SIGNED_OUT') {
        currentUserIdRef.current = null;
        hydratedRef.current = false;
        storeActiveBusinessId(null);
        setAuthState(signedOutState());
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        setAuthState((previous) =>
          previous.user
            ? {
                ...previous,
                session,
                user: session?.user ?? previous.user,
              }
            : previous,
        );
        return;
      }

      if (event === 'INITIAL_SESSION') return;

      if (
        event === 'SIGNED_IN' ||
        event === 'USER_UPDATED' ||
        event === 'PASSWORD_RECOVERY'
      ) {
        loadWorkspaceData(session);
      }
    });

    subscription = data.subscription;

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [loadWorkspaceData]);

  const refreshMemberships = useCallback(
    async ({ activateBusinessId } = {}) => {
      const user = authState.user;
      if (!user) return [];

      try {
        const memberships = await loadMemberships(user.id);

        setAuthState((previous) => {
          if (previous.user?.id !== user.id) return previous;

          let activeBusinessId;
          if (
            activateBusinessId &&
            memberships.some(
              (membership) => membership.business.id === activateBusinessId,
            )
          ) {
            activeBusinessId = activateBusinessId;
          } else if (
            previous.activeBusinessId &&
            memberships.some(
              (membership) => membership.business.id === previous.activeBusinessId,
            )
          ) {
            activeBusinessId = previous.activeBusinessId;
          } else {
            activeBusinessId = resolveActiveBusinessId(memberships);
          }

          storeActiveBusinessId(activeBusinessId);

          return {
            ...previous,
            status: 'authenticated',
            memberships,
            activeBusinessId,
            error: null,
          };
        });

        return memberships;
      } catch (error) {
        const normalized = toAuthServiceError(error);
        setAuthState((previous) => ({ ...previous, error: normalized.message }));
        throw normalized;
      }
    },
    [authState.user],
  );

  const refreshPlatformAccess = useCallback(
    async ({ activateBusinessId } = {}) => {
      const user = authState.user;
      if (!user) return null;

      try {
        const [platform, memberships] = await Promise.all([
          fetchPlatformContext(),
          loadMemberships(user.id),
        ]);

        setAuthState((previous) => {
          if (previous.user?.id !== user.id) return previous;

          const supportBusinessIds = platform?.supportBusinessIds ?? [];
          let activeBusinessId;
          if (
            activateBusinessId &&
            (memberships.some(
              (membership) => membership.business.id === activateBusinessId,
            ) ||
              supportBusinessIds.includes(activateBusinessId))
          ) {
            activeBusinessId = activateBusinessId;
          } else if (
            previous.activeBusinessId &&
            supportBusinessIds.includes(previous.activeBusinessId)
          ) {
            activeBusinessId = previous.activeBusinessId;
          } else if (
            previous.activeBusinessId &&
            memberships.some(
              (membership) => membership.business.id === previous.activeBusinessId,
            )
          ) {
            activeBusinessId = previous.activeBusinessId;
          } else {
            activeBusinessId = resolveActiveBusinessId(memberships);
          }

          storeActiveBusinessId(activeBusinessId);
          return {
            ...previous,
            status: 'authenticated',
            platform,
            memberships,
            activeBusinessId,
            error: null,
          };
        });

        return platform;
      } catch (error) {
        const normalized = toAuthServiceError(error);
        setAuthState((previous) => ({ ...previous, error: normalized.message }));
        throw normalized;
      }
    },
    [authState.user],
  );

  const activateSupportSession = useCallback((session) => {
    if (!session?.id || !session?.business_id) return null;

    setAuthState((previous) => {
      if (!previous.user || session.actor_user_id !== previous.user.id) {
        return previous;
      }

      const memberships = mergeSupportSessionMemberships(previous.memberships, [
        session,
      ]);
      const supportBusinessIds = [
        ...new Set([
          ...(previous.platform?.supportBusinessIds ?? []),
          session.business_id,
        ]),
      ];

      storeActiveBusinessId(session.business_id);
      return {
        ...previous,
        status: 'authenticated',
        memberships,
        activeBusinessId: session.business_id,
        platform: { ...EMPTY_PLATFORM, ...previous.platform, supportBusinessIds },
        error: null,
      };
    });

    return session.business_id;
  }, []);

  const selectBusiness = useCallback((businessId) => {
    setAuthState((previous) => {
      const exists = previous.memberships.some(
        (membership) => membership.business.id === businessId,
      );
      if (!exists) return previous;

      storeActiveBusinessId(businessId);
      return { ...previous, activeBusinessId: businessId };
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutRequest();
    } finally {
      currentUserIdRef.current = null;
      hydratedRef.current = false;
      storeActiveBusinessId(null);
      setAuthState(signedOutState());
    }
  }, []);

  const retry = useCallback(async () => {
    if (!env.isSupabaseConfigured) {
      setAuthState(
        signedOutState(
          'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local and restart the dev server.',
        ),
      );
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      await loadWorkspaceData(data.session, { force: true });
    } catch (error) {
      setAuthState(errorState(toAuthServiceError(error).message));
    }
  }, [loadWorkspaceData]);

  const revalidate = useCallback(async () => {
    if (!authState.user) return;

    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        currentUserIdRef.current = null;
        hydratedRef.current = false;
        storeActiveBusinessId(null);
        setAuthState(signedOutState());
        return;
      }

      await refreshPlatformAccess();
    } catch {
      // Focus revalidation is best-effort; explicit actions surface their own errors.
    }
  }, [authState.user, refreshPlatformAccess]);

  useEffect(() => {
    if (authState.status !== 'authenticated') return undefined;

    let lastRun = 0;

    const handleRevalidate = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastRun < 30000) return;
      lastRun = now;
      revalidate();
    };

    window.addEventListener('focus', handleRevalidate);
    document.addEventListener('visibilitychange', handleRevalidate);

    return () => {
      window.removeEventListener('focus', handleRevalidate);
      document.removeEventListener('visibilitychange', handleRevalidate);
    };
  }, [authState.status, revalidate]);

  const activeMembership = useMemo(
    () =>
      authState.memberships.find(
        (membership) => membership.business.id === authState.activeBusinessId,
      ) ?? null,
    [authState.memberships, authState.activeBusinessId],
  );

  const value = useMemo(
    () => ({
      ...authState,
      activeBusiness: activeMembership?.business ?? null,
      activeMembership,
      isConfigured: env.isSupabaseConfigured,
      refreshMemberships,
      refreshPlatformAccess,
      activateSupportSession,
      selectBusiness,
      signOut,
      retry,
    }),
    [
      authState,
      activeMembership,
      refreshMemberships,
      refreshPlatformAccess,
      activateSupportSession,
      selectBusiness,
      signOut,
      retry,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
