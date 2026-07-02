export type GuestbookStatus = 'pending' | 'approved' | 'rejected';

export interface IntegrationStatus {
  name: string;
  healthy: boolean;
  detail: string;
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
