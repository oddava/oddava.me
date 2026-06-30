import { describe, expect, it } from 'vitest';
import {
  getApprovedGuestbookEntries,
  normalizeGuestbookEntry,
  parseGuestbookStatus,
  toPublicGuestbookEntries,
  type GuestbookEntry,
} from '../src/lib/server/guestbook';

describe('server guestbook helpers', () => {
  it('parses only known guestbook statuses', () => {
    expect(parseGuestbookStatus('pending')).toBe('pending');
    expect(parseGuestbookStatus('approved')).toBe('approved');
    expect(parseGuestbookStatus('rejected')).toBe('rejected');
    expect(parseGuestbookStatus('archived')).toBeNull();
    expect(parseGuestbookStatus(null)).toBeNull();
  });

  it('normalizes legacy or partial entry status safely', () => {
    const entry = normalizeGuestbookEntry({
      createdAt: '2026-06-30T00:00:00.000Z',
      id: '1',
      message: 'hello',
      name: 'oddava',
      status: 'archived',
      userAgent: 'browser',
    });

    expect(entry).toEqual({
      createdAt: '2026-06-30T00:00:00.000Z',
      id: '1',
      message: 'hello',
      name: 'oddava',
      status: 'pending',
      userAgent: 'browser',
    });
  });

  it('rejects entries missing required public fields', () => {
    expect(
      normalizeGuestbookEntry({
        createdAt: '2026-06-30T00:00:00.000Z',
        id: '1',
        message: '',
        name: 'oddava',
        status: 'approved',
      }),
    ).toBeNull();
  });

  it('filters and projects approved public entries', () => {
    const entries: GuestbookEntry[] = [
      {
        createdAt: '2026-06-30T00:00:00.000Z',
        id: '1',
        ipFingerprint: 'private',
        message: 'approved',
        name: 'a',
        status: 'approved',
      },
      {
        createdAt: '2026-06-30T00:01:00.000Z',
        id: '2',
        message: 'pending',
        name: 'b',
        status: 'pending',
      },
    ];

    expect(
      toPublicGuestbookEntries(getApprovedGuestbookEntries(entries)),
    ).toEqual([
      {
        createdAt: '2026-06-30T00:00:00.000Z',
        id: '1',
        message: 'approved',
        name: 'a',
      },
    ]);
  });
});
