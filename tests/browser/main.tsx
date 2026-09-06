// Isolated UI fixture. No routes, authentication overrides, or storage fallbacks
// are added to the application. Playwright intercepts API calls in its browser.
import { render } from 'preact';
import { ContentWorkspace } from '../../src/components/admin/ContentWorkspace';
import '../../src/styles/_variables.css';
import '../../src/styles/_fonts.css';
import '../../src/styles/admin.css';
render(<ContentWorkspace fullWidth />, document.getElementById('app')!);
