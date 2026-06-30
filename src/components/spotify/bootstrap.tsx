import { createRoot } from 'react-dom/client';
import SpotifyWidget from '../SpotifyWidget';

const host = document.getElementById('spotify-widget-host');
if (host) {
  createRoot(host).render(<SpotifyWidget />);
}
