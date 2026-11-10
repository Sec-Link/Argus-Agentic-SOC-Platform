// Deep links from dashboard coverage widgets into the Detections rule list (filter state is read from sessionStorage).
const DETECTION_BASE = '/settings/detection';
const PERSIST_KEY = 'siem_detection_rulelist_state_v1';

export const detectionLinkForTechnique = (techniqueId: string) => `attack.${techniqueId.toLowerCase()}`;
export const detectionLinkForTactic = (slug: string) => `attack.${slug.toLowerCase().replace(/-/g, '_')}`;

export const openDetectionsWithSearch = (push: (url: string) => void, search: string) => {
  try {
    window.sessionStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ search, product: 'all', severity: 'all', status: 'all', page: 1 }),
    );
  } catch {
    /* ignore storage errors; the list just opens unfiltered */
  }
  push(DETECTION_BASE);
};
