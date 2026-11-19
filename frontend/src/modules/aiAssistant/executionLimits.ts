import type { AssistantExecutionSettings } from '../../services/aiAssistant/executionSettings';

export type ExecutionSettingsForm = { [Key in keyof AssistantExecutionSettings]: string };

export const EXECUTION_LIMIT_RANGES = {
  execution_timeout_seconds: [30, 7200],
  approval_timeout_seconds: [10, 1800],
  max_iterations: [1, 1000],
  coordinator_max_iterations: [2, 1001],
  max_delegations: [1, 1000],
} as const;

export function parseExecutionLimit(field: keyof AssistantExecutionSettings, value: unknown): number {
  const [minimum, maximum] = EXECUTION_LIMIT_RANGES[field];
  const number = typeof value === 'string' && value !== '' && !/[^0-9]/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`Enter a whole number from ${minimum} to ${maximum} using digits only.`);
  }
  return number;
}

export function buildExecutionSettings(values: ExecutionSettingsForm): AssistantExecutionSettings {
  const settings = Object.fromEntries(
    (Object.keys(EXECUTION_LIMIT_RANGES) as Array<keyof AssistantExecutionSettings>)
      .map((field) => [field, parseExecutionLimit(field, values[field])]),
  ) as unknown as AssistantExecutionSettings;
  if (settings.approval_timeout_seconds > settings.execution_timeout_seconds) {
    throw new Error('Approval waiting time cannot exceed the whole-message time limit.');
  }
  return settings;
}

export function executionSettingsFormValues(settings: AssistantExecutionSettings): ExecutionSettingsForm {
  return Object.fromEntries(
    (Object.keys(EXECUTION_LIMIT_RANGES) as Array<keyof AssistantExecutionSettings>)
      .map((field) => [field, String(settings[field])]),
  ) as ExecutionSettingsForm;
}
