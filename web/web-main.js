// Interactive web-app entry. Installs the window.slidey adapter (the deck and
// nav drive the same store the render harness uses) and mounts the App root.
import { createApp } from 'vue';
import App from './components/App.vue';
import { installAdapter } from './slideyAdapter.js';
import './styles/template.css';
import './styles/app.css';
import './styles/workspace.css';

installAdapter();
createApp(App).mount('#app');
