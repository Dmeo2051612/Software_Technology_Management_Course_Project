import { expect, it } from 'vitest';
import { validContactPhone, validPrice, validQuantity } from './validation';

it('matches backend phone and numeric precision rules', () => {
  expect(validContactPhone('+84 912 345 678')).toBe(true);
  expect(validContactPhone('abc')).toBe(false);
  expect(validQuantity(0.333)).toBe(true);
  expect(validQuantity(0)).toBe(false);
  expect(validQuantity(0.3333)).toBe(false);
  expect(validPrice(123.45)).toBe(true);
  expect(validPrice(123.456)).toBe(false);
});
