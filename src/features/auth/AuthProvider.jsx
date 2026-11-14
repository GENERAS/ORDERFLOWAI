import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { env } from '../../lib/env';
import { getSupabaseClient } from '../../lib/supabase/client';
import {
  fetchMemberships,
  fetchProfile,
  signOut as signOutRequest,
  toAuthServiceError,
} from '../../services/authService';
import { AuthContext } from './authContext';

const ACTIVE_BUSINESS_STORAGE_KEY = 'orderflow.activeBusinessId';

const EMPTY_STATE = Object.freeze({
  status: 'loading',
  session: null,
  user: null,
  profile: null,
  memberships: [],
  activeBusinessId: null,
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

function resolveActiveBusinessId(memberships) {
  if (memberships.length === 1) {
    return memberships[0].business.id;
  }

  const stored = readStoredActiveBusinessId();
  if (stored && memberships.some((membership) => membership.business.id === stored)) {
    return stored;
  }

  return null;
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
      const [profile, memberships] = await Promise.all([
        fetchProfile(userId),
        fetchMemberships(userId),
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
        const memberships = await fetchMemberships(user.id);

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

      await refreshMemberships();
    } catch {
      // Focus revalidation is best-effort; explicit actions surface their own errors.
    }
  }, [authState.user, refreshMemberships]);

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
      selectBusiness,
      signOut,
      retry,
    }),
    [
      authState,
      activeMembership,
      refreshMemberships,
      selectBusiness,
      signOut,
      retry,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
