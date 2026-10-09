export const validContactPhone = (phone: string): boolean => /^\+?[0-9 .]{8,15}$/.test(phone);

export function validQuantity(value: number): boolean {
  return Number.isFinite(value) && value > 0 && /^\d+(?:\.\d{1,3})?$/.test(String(value));
}

export function validPrice(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && /^\d+(?:\.\d{1,2})?$/.test(String(value));
}
