export function parseAgentLimit(value: unknown): number {
  if (typeof value !== 'string' || !value || /[^0-9]/.test(value)) {
    throw new Error('Enter a whole number from 1 to 100 using digits only.');
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Enter a whole number from 1 to 100 using digits only.');
  }
  return limit;
}
