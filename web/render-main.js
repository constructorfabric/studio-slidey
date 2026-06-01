// Render-harness entry. Mounts the deck, installs the window.slidey adapter that
// renderer.js / src/pdf.js drive, then flags __slideyReady so the renderer waits
// for mount before issuing the first command.
import { createApp, nextTick } from 'vue';
import DeckHost from './components/DeckHost.vue';
import { installAdapter, markReady } from './slideyAdapter.js';
import './styles/template.css';

installAdapter();

const app = createApp(DeckHost);
app.mount('#app');

// Two ticks so the initial render + body-class watchEffect have flushed.
nextTick().then(() => nextTick()).then(markReady);
