export function hasPermission(permissions: string[] | undefined, required?: string): boolean {
  if (!required) return true;
  if (!Array.isArray(permissions)) return false;
  return permissions.includes(required);
}
