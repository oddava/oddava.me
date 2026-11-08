// Isolated dashboard fixture. Playwright answers the admin API in the browser
// (see admin-mocks.ts); nothing here reaches a real store.
import { render } from 'preact';
import AdminPanel from '../../src/components/admin/AdminPanel';
import '../../src/styles/_variables.css';
import '../../src/styles/_fonts.css';
import '../../src/styles/admin.css';
import { mountQuiet } from '../../src/lib/awake/quiet';
render(<AdminPanel />, document.getElementById('app')!);
mountQuiet();
