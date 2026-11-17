// Helpers for Argus module management (backend: siem_project/modules.py).
//
// The backend is the authority on which modules are loaded and enforces every
// rule. These helpers only keep the UI consistent with it: hiding navigation
// for modules that are not loaded and keeping a draft selection valid.
// Pure functions, covered by moduleState.test.mjs.
import type { RouteKey } from '../../route';

export type ModuleInfo = {
  key: string;
  label: string;
  description: string;
  core: boolean;
  requires: string[];
  required_by: string[];
  active: boolean;
  desired_enabled: boolean;
  effective_enabled: boolean;
  disabled_reason: 'admin' | 'environment' | 'dependency' | null;
  env_disabled: boolean;
  pending_restart: boolean;
};

// Route -> backend module that serves it. Routes that are not listed belong
// to core modules, which are always loaded.
export const moduleByRouteKey: Partial<Record<RouteKey, string>> = {
  reports: 'reports',
  orchestrator: 'orchestrator',
  interfaces: 'workflow_interfaces',
  correlation: 'correlation',
  workflows: 'workflows',
  'workflow-executions': 'workflows',
};

// `enabledModules` is null until the list has loaded, or when loading failed.
// In that case every route stays visible: the backend still rejects requests
// to a disabled module, so failing open here cannot bypass anything.
export function isRouteModuleEnabled(key: RouteKey, enabledModules: string[] | null): boolean {
  const moduleKey = moduleByRouteKey[key];
  if (!moduleKey || !enabledModules) return true;
  return enabledModules.includes(moduleKey);
}

function closure(modules: ModuleInfo[], start: string, edge: 'requires' | 'required_by'): string[] {
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const found = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    for (const next of byKey.get(pending.pop() as string)?.[edge] || []) {
      if (!found.has(next)) {
        found.add(next);
        pending.push(next);
      }
    }
  }
  return modules.map((m) => m.key).filter((key) => found.has(key));
}

// Modules that must also be disabled when `key` is disabled.
export function dependentsOf(modules: ModuleInfo[], key: string): string[] {
  return closure(modules, key, 'required_by');
}

// Modules that must also be enabled when `key` is enabled.
export function requirementsOf(modules: ModuleInfo[], key: string): string[] {
  return closure(modules, key, 'requires');
}

// Apply one switch change to the draft set of disabled modules and return the
// new set plus the other modules that changed with it. Core modules are never
// disabled.
export function toggleModule(
  modules: ModuleInfo[],
  disabled: string[],
  key: string,
  enable: boolean,
): { disabled: string[]; alsoChanged: string[] } {
  const target = modules.find((m) => m.key === key);
  if (!target || target.core) return { disabled, alsoChanged: [] };

  const next = new Set(disabled);
  const related = enable ? requirementsOf(modules, key) : dependentsOf(modules, key);
  const alsoChanged = related.filter((k) => (enable ? next.has(k) : !next.has(k)));
  for (const k of [key, ...related]) {
    if (enable) next.delete(k);
    else next.add(k);
  }
  return { disabled: modules.map((m) => m.key).filter((k) => next.has(k)), alsoChanged };
}
