import client from '../../api';

export interface AssistantExecutionSettings {
  execution_timeout_seconds: number;
  approval_timeout_seconds: number;
  max_iterations: number;
  coordinator_max_iterations: number;
  max_delegations: number;
}

const endpoint = '/ai-assistant/execution-settings/';

export async function getAiAssistantExecutionSettings(): Promise<AssistantExecutionSettings> {
  return (await client.get(endpoint)).data;
}

export async function updateAiAssistantExecutionSettings(
  settings: AssistantExecutionSettings,
): Promise<AssistantExecutionSettings> {
  return (await client.patch(endpoint, settings)).data;
}
