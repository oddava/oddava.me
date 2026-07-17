import { describe, expect, it } from 'vitest';
import {
  getApprovedGuestbookEntries,
  getPublicGuestbookEntries,
  normalizeGuestbookEntry,
  parseGuestbookStatus,
  PUBLIC_GUESTBOOK_ENTRY_LIMIT,
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

  it('builds the public view: approved only, private fields stripped', () => {
    const entries: GuestbookEntry[] = [
      {
        createdAt: '2026-06-30T00:00:00.000Z',
        id: '1',
        ipFingerprint: 'private',
        message: 'approved',
        name: 'a',
        status: 'approved',
        userAgent: 'browser',
      },
      {
        createdAt: '2026-06-30T00:01:00.000Z',
        id: '2',
        message: 'pending',
        name: 'b',
        status: 'pending',
      },
      {
        createdAt: '2026-06-30T00:02:00.000Z',
        id: '3',
        message: 'rejected',
        name: 'c',
        status: 'rejected',
      },
    ];

    expect(getPublicGuestbookEntries(entries)).toEqual([
      {
        createdAt: '2026-06-30T00:00:00.000Z',
        id: '1',
        message: 'approved',
        name: 'a',
      },
    ]);
  });

  it('caps the public view at the latest 100 entries', () => {
    const makeEntry = (index: number, status: GuestbookEntry['status']) => ({
      createdAt: new Date(Date.UTC(2026, 5, 30, 0, 0, index)).toISOString(),
      id: `entry-${index}`,
      message: `message ${index}`,
      name: 'a',
      status,
    });
    // Store order is newest-first; index 0 is the most recent entry.
    const entries: GuestbookEntry[] = Array.from({ length: 130 }, (_, index) =>
      makeEntry(index, 'approved'),
    );

    const publicEntries = getPublicGuestbookEntries(entries);

    expect(PUBLIC_GUESTBOOK_ENTRY_LIMIT).toBe(100);
    expect(publicEntries).toHaveLength(PUBLIC_GUESTBOOK_ENTRY_LIMIT);
    expect(publicEntries[0]?.id).toBe('entry-0');
    expect(publicEntries[99]?.id).toBe('entry-99');
  });

  it('caps after filtering so pending entries do not crowd out approved ones', () => {
    const entries: GuestbookEntry[] = [
      ...Array.from({ length: 105 }, (_, index) => ({
        createdAt: new Date(Date.UTC(2026, 5, 30, 0, 0, index)).toISOString(),
        id: `pending-${index}`,
        message: `pending ${index}`,
        name: 'a',
        status: 'pending' as const,
      })),
      {
        createdAt: '2026-06-29T00:00:00.000Z',
        id: 'approved-old',
        message: 'still visible',
        name: 'b',
        status: 'approved',
      },
    ];

    expect(getPublicGuestbookEntries(entries)).toEqual([
      {
        createdAt: '2026-06-29T00:00:00.000Z',
        id: 'approved-old',
        message: 'still visible',
        name: 'b',
      },
    ]);
  });
});
