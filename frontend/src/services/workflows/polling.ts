export function startWorkflowPolling(refresh: () => Promise<unknown>): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let refreshing = false;

  const schedule = () => {
    if (!stopped && !document.hidden) timer = setTimeout(refreshOnce, 5000);
  };

  const refreshOnce = async () => {
    if (stopped || document.hidden || refreshing) return;
    refreshing = true;
    try {
      await refresh();
    } catch {
      // Callers handle display errors; a failed refresh must not end polling.
    } finally {
      refreshing = false;
      schedule();
    }
  };

  const onVisibilityChange = () => {
    clearTimeout(timer);
    if (!document.hidden) void refreshOnce();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
