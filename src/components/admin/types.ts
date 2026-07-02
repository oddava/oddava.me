export type GuestbookStatus = 'pending' | 'approved' | 'rejected';

export interface IntegrationStatus {
  name: string;
  key?: string;
  healthy: boolean;
  detail: string;
  manageable?: boolean;
  enabled?: boolean;
}

export interface OverviewResponse {
  metrics: {
    posts: number;
    drafts: number;
    projects: number;
    featuredProjects: number;
    books: number;
    pendingGuestbook: number;
    approvedGuestbook: number;
  };
  integrations: IntegrationStatus[];
}

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  status: GuestbookStatus;
  ipFingerprint?: string;
  userAgent?: string;
}

export interface GuestbookResponse {
  entries: GuestbookEntry[];
}

export type CredentialSource = 'override' | 'env' | 'default' | 'none';

export interface CredentialFieldStatus {
  set: boolean;
  source: CredentialSource;
}

export interface SpotifyCredentialsStatus {
  spotify: {
    clientId: CredentialFieldStatus;
    clientSecret: CredentialFieldStatus;
    refreshToken: CredentialFieldStatus;
  };
  lanyard: {
    discordUserId: CredentialFieldStatus;
  };
}

export interface SpotifyCredentialsResponse {
  credentials: SpotifyCredentialsStatus;
}
