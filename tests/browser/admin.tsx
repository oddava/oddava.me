// Isolated dashboard fixture. Playwright answers the admin API in the browser
// (see admin-mocks.ts); nothing here reaches a real store.
// The sheets come first, as on the page: the layout's before the island's.
import '../../src/styles/_variables.css';
import '../../src/styles/portfolio/portfolio.css';
import '../../src/styles/admin/cabinet.css';
import { render } from 'preact';
import AdminPanel from '../../src/components/admin/AdminPanel';
render(<AdminPanel />, document.getElementById('app')!);
