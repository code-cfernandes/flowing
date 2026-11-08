<script setup lang="ts">
import { ref } from 'vue';
import { withBase } from 'vitepress';

const installCommand = 'npm install flowingts';

const copied = ref(false);

async function copyInstall() {
  try {
    await navigator.clipboard.writeText(installCommand);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    copied.value = false;
  }
}

/** Um schema, usado em quatro etapas da requisição (é a ordem real do pipeline). */
const contract = [
  { title: 'Valida a entrada', text: 'body, params e query passam pelo Ajv antes do handler. Um erro vira 400 em Problem Details.' },
  { title: 'Tipa o ctx', text: 'ctx.body e ctx.params chegam com os tipos do schema, sem declarar nada duas vezes.' },
  { title: 'Filtra a resposta', text: 'Campos fora do schema não saem. Um password esquecido no objeto não vaza.' },
  { title: 'Documenta a API', text: 'O mesmo schema gera o OpenAPI 3.1 e a página /docs.' },
];

const included = [
  {
    term: 'Segurança',
    text: 'Headers de segurança, validação de Host, CSRF, CORS, rate limit, limite de body e timeouts, ligados por padrão.',
  },
  { term: 'Composição', text: 'app.mount() e app.group() com prefixos, middlewares, guards, hooks e virtual hosts. Sem container de DI.' },
  {
    term: 'Produção',
    text: 'Shutdown gracioso com drain para o balanceador, healthchecks e HTTPS com troca de certificado sem reiniciar.',
  },
  { term: 'Streaming', text: 'SSE, NDJSON e arquivos, com cancelamento pelo ctx.signal quando o cliente sai ou o app encerra.' },
  {
    term: 'Observabilidade',
    text: 'OpenTelemetry pelo próprio @opentelemetry/api, ctx.route com o template da rota e logs com request id e redact.',
  },
  { term: 'Erros', text: 'Problem Details em toda resposta de erro, com a fase em que o erro aconteceu para quem observa.' },
];

/** O que o projeto precisa aceitar antes de adotar: dito de frente, para ninguém descobrir depois. */
const constraints = [
  {
    term: 'Só decorators padrão (TC39)',
    text: 'Não convive no mesmo projeto com bibliotecas que exigem experimentalDecorators, como NestJS e TypeORM.',
  },
  { term: 'ESM e Node.js 22+', text: 'Sem CommonJS. Versões anteriores do Node não são suportadas.' },
  { term: 'Sem container de DI', text: 'As dependências entram pelo construtor, no ponto em que o app é montado.' },
  { term: 'API em 0.x', text: 'Pode mudar entre versões minor, sempre com a migração descrita no CHANGELOG.' },
];
</script>

<template>
  <div class="sk-home">
    <section class="sk-hero" aria-labelledby="sk-title">
      <div class="sk-hero__inner">
        <div class="sk-hero__text">
          <p class="fl-badge">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z"/><path d="M4 7.4 12 12l8-4.6M12 12v9.2"/></svg>
            Framework HTTP para Node.js
          </p>
          <h1 id="sk-title" class="fl-title">Structure that <em>flows.</em></h1>
          <p class="fl-subtitle">Consistency without complexity.</p>
          <p class="sk-lede">
            Rotas declarativas, contratos explícitos e composição flexível. Toda a equipe declara rotas do mesmo jeito,
            sem a estrutura pesada que o projeto não precisa.
          </p>
          <div class="sk-actions">
            <a class="fl-button fl-button--primary" :href="withBase('/guia/introducao')">
              Começar agora
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </a>
            <a class="fl-button fl-button--ghost" href="https://github.com/code-cfernandes/flowing">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>
              Ver no GitHub
            </a>
          </div>
          <button type="button" class="fl-install" :aria-label="`Copiar o comando ${installCommand}`" @click="copyInstall">
            <span class="fl-install__prompt" aria-hidden="true">$</span>
            <code>{{ installCommand }}</code>
            <span class="fl-install__state" aria-live="polite">{{ copied ? 'Copiado' : 'Copiar' }}</span>
          </button>
        </div>

        <figure class="fl-window" aria-label="Exemplo de rota com contrato">
          <div class="fl-window__bar">
            <span class="fl-window__dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="fl-window__tab"><b>TS</b> user.routes.ts</span>
          </div>
          <pre><code><span class="t-k">const</span> buscar = {
  params: Type.<span class="t-f">Object</span>({
    id: Type.<span class="t-f">String</span>({ format: <span class="t-s">'uuid'</span> }),
  }),
  response: { <span class="t-n">200</span>: User },
} <span class="t-k">satisfies</span> RouteSchemas;

<span class="t-d">@Router</span>(<span class="t-s">'/users'</span>)
<span class="t-k">export class</span> <span class="t-c">UserRoutes</span> {
  <span class="t-d">@Get</span>(<span class="t-s">'/:id'</span>, buscar)
  <span class="t-k">async</span> <span class="t-f">getById</span>(ctx: <span class="t-c">Context</span>&lt;<span class="t-k">typeof</span> buscar&gt;) {
    <span class="t-k">return</span> users.<span class="t-f">find</span>(ctx.params.id);
  }
}</code></pre>
        </figure>
      </div>
    </section>

    <section class="sk-section" aria-labelledby="sk-contract">
      <h2 id="sk-contract">Um schema, usado quatro vezes</h2>
      <p class="sk-section__lede">O contrato é escrito uma vez, com TypeBox, e o framework o usa em cada etapa da requisição.</p>
      <ol class="sk-thread">
        <li v-for="step in contract" :key="step.title" class="sk-patch">
          <h3>{{ step.title }}</h3>
          <p>{{ step.text }}</p>
        </li>
      </ol>
    </section>

    <section class="sk-section" aria-labelledby="sk-included">
      <h2 id="sk-included">O que já vem no lugar</h2>
      <dl class="sk-included">
        <div v-for="item in included" :key="item.term" class="sk-patch">
          <dt>{{ item.term }}</dt>
          <dd>{{ item.text }}</dd>
        </div>
      </dl>
    </section>

    <section class="sk-section sk-section--last" aria-labelledby="sk-before">
      <div class="sk-notice">
        <h2 id="sk-before">Antes de adotar</h2>
        <p class="sk-notice__lede">O que o Flowing exige do seu projeto.</p>
        <dl class="sk-constraints">
          <div v-for="c in constraints" :key="c.term">
            <dt>{{ c.term }}</dt>
            <dd>{{ c.text }}</dd>
          </div>
        </dl>
      </div>
      <p class="sk-section__more">
        <a :href="withBase('/guia/instalacao')">Requisitos e instalação</a>
        <a :href="withBase('/guia/exemplos')">Exemplos completos</a>
      </p>
    </section>
  </div>
</template>

<style scoped>
/*
 * O cenário da página inicial (identidade v2): um fundo só, do topo ao rodapé. A página é sempre escura, também no
 * modo claro, para o fluxo não ser cortado por seções de outra cor; as páginas de documentação seguem o tema.
 */
.sk-home {
  --sk-gutter: clamp(16px, 4vw, 48px);
  --vp-c-text-1: var(--fl-cloud);
  --vp-c-text-2: #94a3b8;
  --vp-c-brand-1: var(--fl-cyan);
  --vp-c-divider: var(--fl-border);
  position: relative;
  isolation: isolate;
  overflow: hidden;
  color: var(--fl-cloud);
  color-scheme: dark;
  background-color: var(--fl-midnight);
  background-image:
    radial-gradient(900px 700px at 88% 0%, rgba(34, 211, 238, 0.14), transparent 70%),
    radial-gradient(800px 700px at 0% 45%, rgba(139, 92, 246, 0.12), transparent 70%),
    radial-gradient(900px 800px at 100% 100%, rgba(34, 211, 238, 0.1), transparent 70%);
}

/*
 * O feixe de ondas fica fixo na tela, atrás de tudo: o conteúdo rola por cima e as ondas acompanham a leitura,
 * do herói ao rodapé, sem corte entre as seções.
 */
.sk-home::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: url('/flow-waves.svg') center / cover no-repeat;
  opacity: 0.9;
}

/* O herói é transparente: o fundo é o da página inteira. */
.sk-hero {
  position: relative;
  color: var(--fl-cloud);
}

.sk-hero__inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: clamp(48px, 8vw, 104px) var(--sk-gutter) clamp(48px, 7vw, 88px);
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr);
  gap: clamp(32px, 5vw, 64px);
  align-items: center;
}

/* O selo acima do título: uma pílula com borda ciano. */
.fl-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 24px;
  padding: 6px 14px;
  border: 1px solid rgba(34, 211, 238, 0.55);
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.06);
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--fl-cloud);
}
.fl-badge svg {
  color: var(--fl-cyan);
}

/* O título: "flows" em itálico com o degradê da marca, do ciano ao azul. */
.fl-title {
  margin: 0;
  font-size: clamp(2.4rem, 4.6vw, 3.45rem);
  line-height: 1.05;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.fl-title em {
  font-style: italic;
  padding-right: 0.06em;
  background: linear-gradient(90deg, var(--fl-cyan), #60a5fa 70%, var(--fl-violet));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.fl-subtitle {
  margin: 10px 0 0;
  font-size: clamp(1.3rem, 2.4vw, 1.75rem);
  font-weight: 500;
  letter-spacing: -0.015em;
  color: #a5b4fc;
}
.sk-lede {
  margin: 22px 0 0;
  max-width: 50ch;
  font-size: 1.08rem;
  line-height: 1.7;
  color: #cbd5e1;
}
.sk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 32px;
}

.fl-button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 22px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  text-decoration: none;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.fl-button--primary {
  background: var(--fl-cyan);
  color: var(--fl-midnight);
  box-shadow: 0 8px 28px -10px rgba(34, 211, 238, 0.7);
}
.fl-button--primary:hover {
  background: #67e8f9;
}
.fl-button--ghost {
  border: 1px solid rgba(226, 232, 240, 0.35);
  color: var(--fl-cloud);
  background: rgba(11, 18, 32, 0.4);
}
.fl-button--ghost:hover {
  border-color: var(--fl-cloud);
}

/* O comando de instalação: um campo de terminal com o botão de copiar. */
.fl-install {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(100%, 420px);
  margin-top: 18px;
  padding: 12px 16px;
  border: 1px solid var(--fl-border);
  border-radius: 8px;
  background: rgba(18, 27, 43, 0.75);
  color: var(--fl-cloud);
  cursor: pointer;
  text-align: left;
}
.fl-install:hover {
  border-color: rgba(34, 211, 238, 0.5);
}
.fl-install__prompt {
  font-family: var(--vp-font-family-mono);
  color: var(--fl-violet);
}
.fl-install code {
  flex: 1;
  font-family: var(--vp-font-family-mono);
  font-size: 0.95rem;
  background: none;
  color: inherit;
  padding: 0;
}
.fl-install__state {
  font-size: 0.8rem;
  color: #94a3b8;
}
.fl-button:focus-visible,
.fl-install:focus-visible {
  outline: 3px solid var(--fl-cyan);
  outline-offset: 3px;
}

/* A janela de código: barra com os três pontos e a aba do arquivo, sobre vidro fosco. */
.fl-window {
  margin: 0;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(11, 18, 32, 0.78);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  backdrop-filter: blur(12px) saturate(1.2);
  box-shadow:
    0 30px 60px -24px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(34, 211, 238, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  overflow: hidden;
}
.fl-window__bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px 0;
  background: rgba(18, 27, 43, 0.9);
  border-bottom: 1px solid var(--fl-border);
}
.fl-window__dots {
  display: inline-flex;
  gap: 7px;
  padding-bottom: 10px;
}
.fl-window__dots i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #f87171;
}
.fl-window__dots i:nth-child(2) {
  background: #fbbf24;
}
.fl-window__dots i:nth-child(3) {
  background: #4ade80;
}
.fl-window__tab {
  padding: 8px 16px 10px;
  border: 1px solid var(--fl-border);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: rgba(11, 18, 32, 0.9);
  margin-bottom: -1px;
  font-size: 0.85rem;
  color: var(--fl-cloud);
}
.fl-window__tab b {
  margin-right: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #60a5fa;
}
.fl-window pre {
  margin: 0;
  padding: 22px 24px 26px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 0.86rem;
  line-height: 1.8;
  color: #cbd5e1;
}
/* Cores de sintaxe na paleta: violeta nas palavras-chave, ciano nas funções, verde nos decorators. */
.t-k { color: #c4b5fd; }
.t-f { color: #67e8f9; }
.t-s { color: #fda4af; }
.t-n { color: #fcd34d; }
.t-d { color: #4ade80; }
.t-c { color: #93c5fd; }

@media (max-width: 960px) {
  .sk-hero__inner {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Seções sobre o fundo claro (ou o tecido escuro no tema escuro). */
.sk-section {
  max-width: 1152px;
  margin: 0 auto;
  padding: clamp(56px, 8vw, 88px) var(--sk-gutter) 0;
}
.sk-section--last {
  padding-bottom: clamp(64px, 9vw, 104px);
}
.sk-section h2 {
  margin: 0;
  font-size: clamp(1.5rem, 2.6vw, 1.9rem);
  font-weight: 600;
  letter-spacing: -0.018em;
  color: var(--vp-c-text-1);
}
.sk-section__lede {
  margin: 12px 0 0;
  max-width: 60ch;
  color: var(--vp-c-text-2);
  line-height: 1.7;
}

/*
 * Os cards são remendos (boro): um pedaço do mesmo índigo metalizado do herói, com a borda costurada por dentro
 * em ponto corrido. No claro, o remendo é de algodão cru com a costura em índigo.
 */
.sk-patch {
  position: relative;
  border-radius: 12px;
  background: linear-gradient(135deg, #f7f9fc 0%, #edf1f7 55%, #f4f6fa 100%);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 12px 28px -18px rgba(28, 43, 79, 0.45),
    0 0 0 1px rgba(28, 43, 79, 0.08);
  --sk-stitch: rgba(58, 90, 153, 0.45);
  --sk-stitch-hover: rgba(58, 90, 153, 0.9);
}
.sk-home .sk-patch {
  background:
    linear-gradient(112deg, transparent 30%, rgba(205, 220, 245, 0.06) 42%, transparent 54%),
    linear-gradient(150deg, #22335d 0%, #1a2849 50%, #213260 100%);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.07) inset,
    0 18px 36px -20px rgba(2, 6, 18, 0.9),
    0 0 0 1px rgba(238, 241, 245, 0.07);
  --sk-stitch: rgba(238, 241, 245, 0.28);
  --sk-stitch-hover: rgba(238, 241, 245, 0.7);
}
/* A costura da borda, por dentro do remendo. */
.sk-patch::before {
  content: '';
  position: absolute;
  inset: 7px;
  border: 1.5px dashed var(--sk-stitch);
  border-radius: 7px;
  pointer-events: none;
  transition: border-color 0.25s ease;
}
.sk-patch:hover::before {
  border-color: var(--sk-stitch-hover);
}
@media (prefers-reduced-motion: reduce) {
  .sk-patch::before {
    transition: none;
  }
}

/* Quatro remendos pendurados na mesma linha de pontos, na ordem do pipeline. */
.sk-thread {
  list-style: none;
  margin: 40px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
  position: relative;
}
.sk-thread::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  border-top: 2px dashed var(--vp-c-brand-1);
  opacity: 0.55;
}
.sk-thread li {
  margin-top: 22px;
  padding: 30px 24px 26px;
}
/* O nó que prende o remendo à linha. */
.sk-thread li::after {
  content: '';
  position: absolute;
  top: -30px;
  left: 26px;
  width: 2px;
  height: 30px;
  background: repeating-linear-gradient(180deg, var(--vp-c-brand-1) 0 4px, transparent 4px 7px);
  opacity: 0.7;
}
.sk-thread h3 {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.sk-thread p {
  margin: 10px 0 0;
  font-size: 0.95rem;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

/* O que já vem pronto: remendos em três colunas, com o ponto em cruz (jūjizashi) no título. */
.sk-included {
  margin: 36px 0 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.sk-included div {
  padding: 28px 26px 26px;
}
.sk-included dt {
  position: relative;
  padding-left: 26px;
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--vp-c-text-1);
}
.sk-included dt::before,
.sk-included dt::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0.62em;
  width: 14px;
  border-top: 2px dashed var(--vp-c-brand-1);
}
.sk-included dt::after {
  transform: rotate(90deg);
}
.sk-included dd {
  margin: 10px 0 0;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

/*
 * O aviso é um remendo costurado com linha vermelha (aka-ito), também tradicional no sashiko: se destaca dos
 * cards de recursos sem sair da identidade.
 */
.sk-notice {
  position: relative;
  padding: clamp(28px, 4vw, 40px);
  border-radius: 14px;
  background: linear-gradient(135deg, #fbf6f7 0%, #f5edef 100%);
  box-shadow: 0 0 0 1px rgba(160, 50, 70, 0.14);
  --sk-red: #a83248;
}
.sk-home .sk-notice {
  background: linear-gradient(150deg, #2a2340 0%, #231c35 100%);
  box-shadow: 0 0 0 1px rgba(232, 140, 156, 0.18);
  --sk-red: #e88c9c;
}
.sk-notice::before {
  content: '';
  position: absolute;
  inset: 8px;
  border: 2px dashed var(--sk-red);
  border-radius: 8px;
  opacity: 0.55;
  pointer-events: none;
}
.sk-notice h2 {
  color: var(--vp-c-text-1);
}
.sk-notice__lede {
  margin: 8px 0 0;
  color: var(--vp-c-text-2);
}
.sk-constraints {
  margin: 28px 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px 40px;
}
.sk-constraints div {
  position: relative;
  padding-left: 22px;
}
/* Um ponto vermelho de costura ao lado de cada exigência. */
.sk-constraints div::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.45em;
  width: 3px;
  height: calc(100% - 0.6em);
  background: repeating-linear-gradient(180deg, var(--sk-red) 0 6px, transparent 6px 10px);
  border-radius: 2px;
}
.sk-constraints dt {
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--vp-c-text-1);
}
.sk-constraints dd {
  margin: 6px 0 0;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}
@media (max-width: 640px) {
  .sk-constraints {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sk-section__more {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin: 28px 0 0;
}
.sk-section__more a {
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-decoration-style: dashed;
  text-underline-offset: 5px;
}

@media (max-width: 960px) {
  .sk-hero__inner {
    grid-template-columns: minmax(0, 1fr);
  }
  .sk-thread,
  .sk-included {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  /* Em duas linhas, a linha de pontos não liga mais os remendos na ordem: some, junto com os nós. */
  .sk-thread::before,
  .sk-thread li::after {
    display: none;
  }
  .sk-thread li {
    margin-top: 0;
  }
}
@media (max-width: 640px) {
  .fl-window pre {
    padding: 18px 16px 20px;
    font-size: 0.8rem;
  }
  .sk-thread,
  .sk-included {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
