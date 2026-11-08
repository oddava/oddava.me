// Isolated UI fixture for the admin Projects panel. Playwright intercepts its
// API calls in the browser; nothing here reaches a real store.
import { render } from 'preact';
import { ProjectsPanel } from '../../src/components/admin/ProjectsPanel';
import { ToastProvider } from '../../src/components/admin/toast';
import '../../src/styles/_variables.css';
import '../../src/styles/_fonts.css';
import '../../src/styles/admin.css';
render(
  <ToastProvider>
    <ProjectsPanel />
  </ToastProvider>,
  document.getElementById('app')!,
);
