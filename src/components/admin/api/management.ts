import type {
  GuestbookEntry,
  GuestbookResponse,
  GuestbookStatus,
  IntegrationResponse,
  IntegrationsResponse,
  OverviewResponse,
} from '../../../lib/contracts';
import { readJson, jsonBody } from './transport';

const ADMIN_OVERVIEW_TIMEOUT_MS = 12_000;
const INTEGRATION_TEST_TIMEOUT_MS = 20_000;
const INTEGRATIONS_PATH = '/api/admin/integrations';

export function fetchAdminOverview(): Promise<OverviewResponse> {
  return readJson<OverviewResponse>('/api/admin/overview', {
    cache: 'no-store',
    signal: AbortSignal.timeout(ADMIN_OVERVIEW_TIMEOUT_MS),
  });
}

export async function fetchGuestbookEntries(
  status: GuestbookStatus,
): Promise<GuestbookEntry[]> {
  const data = await readJson<GuestbookResponse>(
    `/api/guestbook/admin?status=${status}`,
    { cache: 'no-store' },
  );
  return data.entries;
}

export function updateGuestbookEntryStatus(
  id: string,
  status: GuestbookStatus,
): Promise<GuestbookResponse> {
  return readJson<GuestbookResponse>(
    '/api/guestbook/admin',
    jsonBody('PATCH', { id, status }),
  );
}

export function clearGuestbookEntries(): Promise<GuestbookResponse> {
  return readJson<GuestbookResponse>(
    '/api/guestbook/admin',
    jsonBody('POST', { action: 'clear', all: true }),
  );
}

function integrationPath(id: string, suffix = ''): string {
  return `${INTEGRATIONS_PATH}/${encodeURIComponent(id)}${suffix}`;
}

export function fetchIntegrations(): Promise<IntegrationsResponse> {
  return readJson<IntegrationsResponse>(INTEGRATIONS_PATH, {
    cache: 'no-store',
  });
}

export function toggleIntegration(
  id: string,
  enabled: boolean,
): Promise<IntegrationResponse> {
  return readJson<IntegrationResponse>(
    integrationPath(id),
    jsonBody('PATCH', { enabled }),
  );
}

export function testIntegration(id: string): Promise<IntegrationResponse> {
  return readJson<IntegrationResponse>(integrationPath(id, '/test'), {
    method: 'POST',
    signal: AbortSignal.timeout(INTEGRATION_TEST_TIMEOUT_MS),
  });
}
