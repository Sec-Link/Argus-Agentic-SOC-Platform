export function parseModelPrice(value: unknown): string | null {
  if (value === '' || value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() !== value || !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(value)) {
    throw new Error('Enter a nonnegative price with up to 12 integer digits and 6 decimal places, or leave blank.');
  }
  return value;
}

export function parseModelCurrency(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || !/^[A-Z]{3}$/.test(value)) {
    throw new Error('Enter a three-letter currency code, for example USD or CNY.');
  }
  return value;
}
