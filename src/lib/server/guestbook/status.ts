export type GuestbookStatus = 'pending' | 'approved' | 'rejected';

export function parseGuestbookStatus(
  value: string | null | undefined,
): GuestbookStatus | null {
  if (value === 'pending' || value === 'approved' || value === 'rejected') {
    return value;
  }
  return null;
}
