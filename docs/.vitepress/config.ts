import { createRequire } from 'node:module';
import { defineConfig } from 'vitepress';

const require = createRequire(import.meta.url);
const repo = 'https://github.com/code-cfernandes/flowing';
const { version } = require('../../package.json') as { version: string };

/** Barra lateral da referência, gerada pelo TypeDoc (`pnpm api`). */
function apiSidebar() {
  try {
    return require('../referencia/api/typedoc-sidebar.json');
  } catch {
    return [];
  }
}

export default defineConfig({
  lang: 'pt-BR',
  title: 'FlowingTS',
  description: 'Micro-framework HTTP para Node.js com decorators TC39 nativos, schema-first e seguro por padrão.',
  base: '/flowing/',
  cleanUrls: true,
  lastUpdated: true,
  // Documento interno (cita os IDs do backlog), mantido no repositório e fora do site.
  srcExclude: ['ARCHITECTURE.md'],
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/flowing/logo.svg' }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guia', link: '/guia/introducao', activeMatch: '/guia/' },
      { text: 'Referência', link: '/referencia/create-app', activeMatch: '/referencia/' },
      {
        text: `v${version}`,
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'npm', link: 'https://www.npmjs.com/package/flowingts' },
        ],
      },
    ],
    sidebar: {
      '/guia/': [
        {
          text: 'Começando',
          items: [
            { text: 'Introdução', link: '/guia/introducao' },
            { text: 'Instalação', link: '/guia/instalacao' },
            { text: 'Exemplos', link: '/guia/exemplos' },
            { text: 'Vindo do Express', link: '/guia/vindo-do-express' },
          ],
        },
        {
          text: 'Essencial',
          items: [
            { text: 'Rotas e composição', link: '/guia/rotas' },
            { text: 'Schemas', link: '/guia/schemas' },
            { text: 'Formatos de entrada', link: '/guia/entrada' },
            { text: 'Upload de arquivos', link: '/guia/uploads' },
            { text: 'Respostas e o ctx', link: '/guia/respostas' },
            { text: 'Middlewares e guards', link: '/guia/middlewares-e-guards' },
            { text: 'Erros', link: '/guia/erros' },
          ],
        },
        {
          text: 'Recursos',
          items: [
            { text: 'Estáticos e streaming', link: '/guia/estaticos-e-streaming' },
            { text: 'Hooks de ciclo de vida', link: '/guia/hooks' },
            { text: 'OpenAPI e /docs', link: '/guia/openapi' },
            { text: 'Logs e request id', link: '/guia/logs' },
            { text: 'Observabilidade', link: '/guia/observabilidade' },
          ],
        },
        {
          text: 'Produção',
          items: [
            { text: 'Segurança', link: '/guia/seguranca' },
            { text: 'Ciclo de vida, testes e HTTPS', link: '/guia/ciclo-de-vida' },
            { text: 'Deploy', link: '/guia/deploy' },
          ],
        },
      ],
      '/referencia/': [
        {
          text: 'Referência',
          items: [
            { text: 'createApp(options)', link: '/referencia/create-app' },
            { text: 'Índice da API', link: '/referencia/api/' },
          ],
        },
        { text: 'API (gerada do código)', collapsed: false, items: apiSidebar() },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Editar esta página no GitHub' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
          modal: {
            noResultsText: 'Nenhum resultado para',
            resetButtonTitle: 'Limpar a busca',
            footer: { selectText: 'abrir', navigateText: 'navegar', closeText: 'fechar' },
          },
        },
      },
    },
    outline: { level: [2, 3], label: 'Nesta página' },
    docFooter: { prev: 'Anterior', next: 'Próxima' },
    lastUpdated: { text: 'Atualizado em' },
    returnToTopLabel: 'Voltar ao topo',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Tema',
    lightModeSwitchTitle: 'Tema claro',
    darkModeSwitchTitle: 'Tema escuro',
    notFound: { title: 'Página não encontrada', quote: 'O endereço pode ter mudado.', linkText: 'Voltar ao início' },
    footer: { message: 'Licença ISC.', copyright: 'Copyright © 2026 Caio Fernandes' },
  },
});
