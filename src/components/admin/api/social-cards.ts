import type {
  SocialCardsResponse,
  SocialCardStatus,
} from '../../../lib/contracts';
import { readContentJson } from './transport';

export function fetchSocialCards(): Promise<SocialCardsResponse> {
  return readContentJson<SocialCardsResponse>('/api/admin/social-cards', {
    cache: 'no-store',
  });
}

export function uploadSocialCard(
  card: SocialCardStatus,
  image: Blob,
): Promise<{ card: { path: string; fingerprint: string } }> {
  const formData = new FormData();
  formData.set('path', card.path);
  formData.set('fingerprint', card.fingerprint);
  formData.set('file', image, `${card.path.replaceAll('/', '-')}.png`);

  return readContentJson('/api/admin/social-cards', {
    method: 'POST',
    body: formData,
  });
}
