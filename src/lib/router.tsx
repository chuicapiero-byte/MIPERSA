import { useCallback, useEffect, useState } from 'react';

export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw) return '/panel';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/panel';
  }
  return trimmed;
}

export function getQueryParams(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

export function useSpaRouter() {
  const [locationState, setLocationState] = useState(() => ({
    pathname: window.location.pathname || '/',
    search: window.location.search || '',
  }));

  useEffect(() => {
    const onPopState = () => {
      setLocationState({
        pathname: window.location.pathname || '/',
        search: window.location.search || '',
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, replace = false) => {
    const target = to.startsWith('/') ? to : `/${to}`;
    if (replace) {
      window.history.replaceState(null, '', target);
    } else {
      window.history.pushState(null, '', target);
    }
    const url = new URL(target, window.location.origin);
    setLocationState({
      pathname: url.pathname,
      search: url.search,
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return {
    pathname: locationState.pathname,
    search: locationState.search,
    fullPath: `${locationState.pathname}${locationState.search}`,
    navigate,
  };
}
