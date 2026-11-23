'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { App } from 'antd';
import BasicLayout from '../components/layout/BasicLayout';
import LoginForm from '../modules/accounts/components/LoginForm';
import { isCurrentBrowserSession, readStoredAccessToken } from 'services/accounts';

export default function ClientRoot({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const [hydrated, setHydrated] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean>(false);

  useEffect(() => {
    const syncSession = () => {
      if (!isCurrentBrowserSession()) {
        setHydrated(false);
        // Discard every component, pending action and cached page before using the new identity.
        window.location.reload();
        return;
      }
      setLoggedIn(!!readStoredAccessToken());
      setHydrated(true);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'siem_access_token' || e.key === null) syncSession();
    };
    syncSession();
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', syncSession);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', syncSession);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (loggedIn && pathname === '/') {
      router.replace('/dashboard');
    }
  }, [hydrated, loggedIn, pathname, router]);

  if (!hydrated) {
    return null;
  }

  return (
    <App>
      {!loggedIn ? (
        <LoginForm onLogin={() => setLoggedIn(true)} />
      ) : (
        <BasicLayout onLoggedOut={() => setLoggedIn(false)}>{children}</BasicLayout>
      )}
    </App>
  );
}
