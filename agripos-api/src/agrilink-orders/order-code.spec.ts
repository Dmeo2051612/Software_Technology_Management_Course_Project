import { nextAgrilinkCode, vnDateStamp } from './order-code';

describe('order code', () => {
  it('uses Vietnam date (UTC 18:00 = next day in VN)', () => {
    expect(vnDateStamp(new Date('2026-09-27T18:00:00Z'))).toBe('20260928');
  });
  it('increments the max sequence for the org and day', async () => {
    const query = jest.fn().mockResolvedValue([{ max_num: 7 }]);
    const code = await nextAgrilinkCode(
      query,
      'org-1',
      new Date('2026-09-28T03:00:00Z'),
    );
    expect(code).toBe('AL-20260928-008');
    expect(query.mock.calls[0][1]).toEqual(['org-1', 'AL-20260928-%']);
  });
});
