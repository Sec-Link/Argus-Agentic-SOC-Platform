import { safeGetStorage } from './storage';

export function getStoredAccessToken() {
  return safeGetStorage('siem_access_token');
}

export function getStoredUsername() {
  return safeGetStorage('siem_username');
}
