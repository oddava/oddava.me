// Isolated fixture for the /sky island. Playwright answers /api/sky and
// /api/pulse in the browser; nothing here reaches a real store. The sheets
// come first, as on the page: the layout's before the island's.
import '../../src/styles/_variables.css';
import '../../src/styles/portfolio/portfolio.css';
import '../../src/styles/components/_sky.css';
import { render } from 'preact';
import SkyField from '../../src/components/sky/SkyField';
render(<SkyField />, document.getElementById('app')!);
