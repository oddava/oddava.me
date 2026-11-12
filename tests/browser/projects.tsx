// Isolated UI fixture for the admin Projects panel. Playwright intercepts its
// API calls in the browser; nothing here reaches a real store.
// The sheets come first, as on the page: the layout's before the island's.
import '../../src/styles/_variables.css';
import '../../src/styles/portfolio/portfolio.css';
import '../../src/styles/admin/cabinet.css';
import { render } from 'preact';
import { ProjectsPanel } from '../../src/components/admin/ProjectsPanel';
import { ToastProvider } from '../../src/components/admin/toast';
render(
  <ToastProvider>
    <ProjectsPanel />
  </ToastProvider>,
  document.getElementById('app')!,
);
