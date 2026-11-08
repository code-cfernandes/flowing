import DefaultTheme from 'vitepress/theme';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';
import FlowingHome from './FlowingHome.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('FlowingHome', FlowingHome);
  },
} satisfies typeof DefaultTheme;
