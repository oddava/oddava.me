import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { fetchAdminOverview } from './api';
import { AdminNav, type AdminSection } from './AdminNav';
import { GuestbookModeration } from './GuestbookModeration';
import { IntegrationsPanel } from './IntegrationsPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { ToastProvider } from './toast';
import type { OverviewResponse } from '../../lib/contracts';
import '../../styles/components/_control.css';
import './AdminPanel.css';

export default function AdminPanel() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}

const SECTION_IDS = ['guestbook', 'projects', 'integrations'] as const;

function Dashboard() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [attention, setAttention] = useState(false);
  const overviewRequest = useRef(0);
  const active = useActiveSection(SECTION_IDS);

  /**
   * The count is garnish on the navigation: a failed load leaves it out
   * rather than raising an error nobody can act on.
   */
  const refreshOverview = useCallback(() => {
    const requestId = ++overviewRequest.current;
    fetchAdminOverview()
      .then((data) => {
        if (requestId === overviewRequest.current) setOverview(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshOverview();
    // Bumping the id retires an in-flight response after unmount.
    return () => {
      overviewRequest.current += 1;
    };
  }, [refreshOverview]);

  const metrics = overview?.metrics;
  const sections: AdminSection[] = [
    {
      id: 'guestbook',
      label: 'guestbook',
      // Only entries waiting on a decision earn a number.
      count: metrics?.pendingGuestbook || undefined,
    },
    { id: 'projects', label: 'projects' },
    { id: 'integrations', label: 'integrations', attention },
  ];

  return (
    <div className="adm">
      <AdminNav sections={sections} active={active} />
      <main className="adm-main" id="main">
        <GuestbookModeration
          pending={metrics?.pendingGuestbook}
          onChanged={refreshOverview}
        />
        <ProjectsPanel />
        {/* Owns its own data: health checks reach upstream APIs and must not
            slow down or fail the rest of the dashboard. */}
        <IntegrationsPanel onAttention={setAttention} />
      </main>
    </div>
  );
}

/**
 * The section whose top has passed the upper third of the viewport. At the
 * very bottom the last section wins, even when it is too short to reach that
 * line — otherwise it could never be marked.
 */
function useActiveSection(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      const scrolled = window.scrollY > 0;
      const atBottom =
        scrolled &&
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 2;
      let current = ids[0];
      for (const id of ids) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) current = id;
      }
      setActive(atBottom ? ids[ids.length - 1] : current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // Sections grow as their data arrives, which moves the others without a
    // scroll; watching the page's size catches that too.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids]);

  return active;
}
