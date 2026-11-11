import { render } from 'preact';
import NoteSearch from '../../src/components/garden/NoteSearch';
import { installNavigationFeedback } from '../../src/lib/loading-feedback';
import '../../src/styles/global.css';
import '../../src/styles/components/_note-search.css';
import '../../src/styles/components/_loading-indicator.css';
import '../../src/styles/components/_page-preview.css';
installNavigationFeedback();
render(<NoteSearch />, document.getElementById('app')!);
