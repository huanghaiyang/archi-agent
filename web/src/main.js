import { createApp } from 'vue';
import App from './App.vue';
import { installClientLogging } from './log.js';
import './styles.css';

installClientLogging();
createApp(App).mount('#app');
