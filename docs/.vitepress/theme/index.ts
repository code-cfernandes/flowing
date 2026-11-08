import DefaultTheme from 'vitepress/theme';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';
import './sidebar-icons.css';
import { h } from 'vue';
import FlowingHome from './FlowingHome.vue';
import Aprenda from './Aprenda.vue';
import AsideCards from './AsideCards.vue';
import DocIntro from './DocIntro.vue';
import SidebarHelp from './SidebarHelp.vue';
import SidebarVersion from './SidebarVersion.vue';

export default {
  extends: DefaultTheme,
  // A versão no topo da barra lateral e o card de ajuda no fim, como no protótipo da documentação.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'sidebar-nav-before': () => h(SidebarVersion),
      'sidebar-nav-after': () => h(SidebarHelp),
      'doc-before': () => h(DocIntro),
      'aside-outline-after': () => h(AsideCards),
    }),
  enhanceApp({ app }) {
    app.component('FlowingHome', FlowingHome);
    app.component('Aprenda', Aprenda);
  },
} satisfies typeof DefaultTheme;
