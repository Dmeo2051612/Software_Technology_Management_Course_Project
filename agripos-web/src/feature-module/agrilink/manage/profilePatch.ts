import type { DealerProfile } from '../../../services/agrilink.types';

const editableFields = [
  'name',
  'bio',
  'region',
  'address',
  'phone',
  'openingHours',
  'fulfillmentOptions',
  'marketplaceEnabled',
  'provinceCode',
  'communeCode',
  'lat',
  'lng',
] as const;

export function profilePatch(
  saved: DealerProfile,
  form: DealerProfile,
): Partial<Omit<DealerProfile, 'logoUrl'>> {
  const patch: Partial<Omit<DealerProfile, 'logoUrl'>> = {};
  for (const key of editableFields) {
    if (JSON.stringify(saved[key]) !== JSON.stringify(form[key])) {
      // Each field is already validated and typed in DealerProfile.
      Object.assign(patch, { [key]: form[key] });
    }
  }
  return patch;
}
