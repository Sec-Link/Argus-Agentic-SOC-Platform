import type { PageChatRequest } from '../../api';
import type { ModelCatalogEntry } from '../../services/aiAssistant/models';

export const MODEL_PREFERENCE_KEY = 'argus_ai_model_profile';

export function initialModelChoice(catalog: ModelCatalogEntry[], preferred: string | null): string {
  // Keep a missing saved profile explicit; never silently send its conversation to another model.
  return (preferred !== 'browser' && preferred) || catalog[0]?.id || '';
}

export function chatModelRequest(selection: string): Pick<PageChatRequest, 'model_profile_id'> {
  if (!selection || selection === 'browser') throw new Error('Choose an enabled model in AI Assistant > Models.');
  return { model_profile_id: selection };
}
