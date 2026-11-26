'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PageChatContext } from 'services/aiAssistant';

export type AssistantContextData = Omit<PageChatContext, 'path'>;
type Registration = { path: string; data: AssistantContextData };
const Context = createContext<{
  pathname: string;
  permissionPreview: boolean;
  registration: Registration | null;
  setRegistration: React.Dispatch<React.SetStateAction<Registration | null>>;
} | null>(null);

export function AssistantPageContextProvider({ pathname, permissionPreview, children }: {
  pathname: string; permissionPreview: boolean; children: React.ReactNode;
}) {
  const [registration, setRegistration] = useState<Registration | null>(null);
  const value = useMemo(() => ({ pathname, permissionPreview, registration, setRegistration }), [pathname, permissionPreview, registration]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAssistantPermissionPreview(): boolean {
  return useContext(Context)?.permissionPreview === true;
}

/** Only mounted pages publish their explicitly selected, sanitized data. */
export function useRegisterAssistantContext(data: AssistantContextData) {
  const context = useContext(Context);
  const pathname = context?.pathname;
  const setRegistration = context?.setRegistration;
  useEffect(() => {
    if (!setRegistration || !pathname) return;
    const registration = { path: pathname, data };
    setRegistration(registration);
    return () => setRegistration((current) => current === registration ? null : current);
  }, [data, pathname, setRegistration]);
}

export function useAssistantPageContext(pathname: string): AssistantContextData | null {
  const context = useContext(Context);
  return context?.registration?.path === pathname ? context.registration.data : null;
}
