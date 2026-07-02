import { hasRedisConfig, redisCommand } from '../community';

const SETTINGS_KEY = 'admin:settings';

export type ManageableIntegration = 'spotify';

export interface IntegrationSettings {
  integrations: Record<ManageableIntegration, boolean>;
}

const DEFAULT_SETTINGS: IntegrationSettings = {
  integrations: {
    spotify: true,
  },
};

const SETTINGS_READ_TIMEOUT_MS = 4_000;

async function readSettingsFromStorage(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      redisCommand<string | null>(['GET', SETTINGS_KEY]),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SETTINGS_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  if (!hasRedisConfig()) return DEFAULT_SETTINGS;

  try {
    const raw = await readSettingsFromStorage();
    if (!raw) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(raw) as Partial<IntegrationSettings>;
    const parsedIntegrations: Partial<IntegrationSettings['integrations']> =
      parsed.integrations ?? {};
    return {
      integrations: {
        spotify:
          typeof parsedIntegrations.spotify === 'boolean'
            ? parsedIntegrations.spotify
            : DEFAULT_SETTINGS.integrations.spotify,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setIntegrationSetting(
  name: ManageableIntegration,
  enabled: boolean,
): Promise<IntegrationSettings> {
  const current = await getIntegrationSettings();
  const next: IntegrationSettings = {
    integrations: {
      ...current.integrations,
      [name]: enabled,
    },
  };

  if (hasRedisConfig()) {
    await redisCommand(['SET', SETTINGS_KEY, JSON.stringify(next)]);
  }

  return next;
}
