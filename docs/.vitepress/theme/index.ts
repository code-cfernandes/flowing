import DefaultTheme from 'vitepress/theme';
import '@fontsource/zen-kaku-gothic-new/400.css';
import '@fontsource/zen-kaku-gothic-new/500.css';
import '@fontsource/zen-kaku-gothic-new/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';
import SashikoHome from './SashikoHome.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('SashikoHome', SashikoHome);
  },
} satisfies typeof DefaultTheme;
