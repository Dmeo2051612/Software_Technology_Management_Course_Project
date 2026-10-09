import { expect, it } from 'vitest';
import type { DealerProfile } from '../../../services/agrilink.types';
import { profilePatch } from './profilePatch';

it('sends only changed profile fields and never the uploaded logo', () => {
  const saved = {
    name: 'Đại lý A',
    bio: '',
    region: 'Huế',
    address: '',
    phone: '',
    logoUrl: '/uploads/old.png',
    openingHours: '',
    fulfillmentOptions: ['pickup'],
    marketplaceEnabled: true,
  } as DealerProfile;
  expect(profilePatch(saved, { ...saved, name: 'Đại lý B', logoUrl: '/uploads/new.png' })).toEqual({
    name: 'Đại lý B',
  });
});
