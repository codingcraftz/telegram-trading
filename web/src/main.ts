import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { usePrefs } from './stores/prefs';
import './styles/main.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
usePrefs();
app.mount('#app');
