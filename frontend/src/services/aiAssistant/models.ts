import client from '../../api';

export interface ModelCatalogEntry { id: string; name: string; model: string }
export interface ModelProfile extends ModelCatalogEntry {
  base_url: string;
  timeout_seconds: number;
  enabled: boolean;
  has_api_key: boolean;
  input_price_per_million: string | null;
  output_price_per_million: string | null;
  cached_input_price_per_million: string | null;
  currency: string;
  created_at: string;
  updated_at: string;
}
export type ModelProfileWrite = Partial<Pick<ModelProfile, 'name' | 'model' | 'base_url' | 'timeout_seconds' | 'enabled' | 'input_price_per_million' | 'output_price_per_million' | 'cached_input_price_per_million' | 'currency'>> & {
  api_key?: string; clear_api_key?: boolean;
};
const base = '/ai-assistant/models/';

export async function listModelProfiles(): Promise<{ results: ModelProfile[]; count: number }> {
  return (await client.get(base, { params: { page_size: 50 } })).data;
}
export async function fetchModelCatalog(signal?: AbortSignal): Promise<ModelCatalogEntry[]> {
  return (await client.get(`${base}catalog/`, { signal })).data;
}
export async function createModelProfile(data: ModelProfileWrite): Promise<ModelProfile> {
  return (await client.post(base, data)).data;
}
export async function updateModelProfile(id: string, data: ModelProfileWrite): Promise<ModelProfile> {
  return (await client.patch(`${base}${encodeURIComponent(id)}/`, data)).data;
}
export async function deleteModelProfile(id: string): Promise<void> {
  await client.delete(`${base}${encodeURIComponent(id)}/`);
}
export async function testModelProfile(id: string): Promise<{ ok: boolean; model: string }> {
  return (await client.post(`${base}${encodeURIComponent(id)}/test/`, {})).data;
}
