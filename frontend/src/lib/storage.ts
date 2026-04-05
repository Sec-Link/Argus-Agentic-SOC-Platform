export function safeGetStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore write failures
  }
}

export function safeRemoveStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore remove failures
  }
}
