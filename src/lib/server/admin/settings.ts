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

export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  if (!hasRedisConfig()) return DEFAULT_SETTINGS;

  try {
    const raw = await redisCommand<string | null>(['GET', SETTINGS_KEY]);
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
