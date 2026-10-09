import { BadRequestException } from '@nestjs/common';
import { CommunityService } from './community.service';

describe('farmer profile location', () => {
  it('rejects a commune from another province', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('FROM community_profiles WHERE user_id'))
        return Promise.resolve([]);
      if (sql.includes('FROM admin_provinces'))
        return Promise.resolve([{ code: 'dak-lak' }]);
      if (sql.includes('FROM admin_communes'))
        return Promise.resolve([{ province_code: 'lam-dong' }]);
      return Promise.resolve([]);
    });
    const service = new CommunityService({ query } as any);
    await expect(
      service.updateProfile(
        { id: 'farmer-1', role: 'farmer', suspended: false } as any,
        {
          displayName: 'Anh Ba',
          bio: '',
          region: '',
          crops: '',
          provinceCode: 'dak-lak',
          communeCode: 'xa-1',
        },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO community_profiles'),
      ),
    ).toBe(false);
  });
});
