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
  { title: 'Valida a entrada', text: 'body, params e query são validados antes do handler. Um erro vira 400 em Problem Details.' },
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

/** Os quatro pilares do mockup, cada um com o ícone (traço de 24 px). */
const pillars = [
  {
    title: 'Rotas declarativas',
    text: 'Uma forma consistente de declarar rotas, que qualquer pessoa da equipe reconhece.',
    icon: 'M8 7 3 12l5 5M16 7l5 5-5 5M14 4l-4 16',
  },
  {
    title: 'Contratos e validação',
    text: 'Um contrato por rota valida a entrada, tipa o ctx, filtra a resposta e gera o OpenAPI.',
    icon: 'M12 3 3 7.5l9 4.5 9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
  },
  {
    title: 'Composição flexível',
    text: 'Use só o que o projeto precisa: middlewares, guards, hooks e grupos de rotas.',
    icon: 'M9 3h6v4a2 2 0 1 0 0 4v4h-4a2 2 0 1 1-4 0H3V9h4a2 2 0 1 0 0-4V3h2',
  },
  {
    title: 'Infraestrutura pronta',
    text: 'Segurança, uploads, streaming, observabilidade e shutdown gracioso de fábrica.',
    icon: 'M14 4c3 0 6 3 6 6l-6 6-6-6c0-3 3-6 6-6ZM8 16l-3 3M10 18l-2 3M6 14l-3 2M15 9.5a1 1 0 1 0 0-.01',
  },
];

/** As tecnologias e recursos em destaque, em pílulas no fim da página. */
const pills = ['TypeScript', 'Decorators TC39', 'Validação', 'OpenAPI 3.1', 'Observabilidade', 'Uploads'];

/** O que o projeto precisa aceitar antes de adotar: dito de frente, para ninguém descobrir depois. */
const constraints = [
  {
    term: 'Só decorators padrão (TC39)',
    text: 'Não convive no mesmo projeto com bibliotecas que exigem experimentalDecorators, como NestJS e TypeORM.',
  },
  { term: 'Node.js 22.12+', text: 'ESM ou CommonJS (pelo require de módulos ESM do Node). Versões anteriores não são suportadas.' },
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

    <section class="sk-section" aria-label="Recursos principais">
      <ul class="fl-pillars">
        <li v-for="p in pillars" :key="p.title">
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path :d="p.icon" /></svg>
          <h3>{{ p.title }}</h3>
          <p>{{ p.text }}</p>
        </li>
      </ul>
    </section>

    <section class="sk-section fl-problem" aria-labelledby="fl-problem">
      <div>
        <p class="fl-eyebrow">O problema</p>
        <h2 id="fl-problem">Liberdade sem convenção gera inconsistência. Arquitetura obrigatória gera complexidade.</h2>
      </div>
      <div class="fl-problem__answer">
        <p>
          O FlowingTS nasce do equilíbrio entre os dois extremos: uma maneira consistente de construir APIs, sem impor
          uma arquitetura pesada ao seu projeto.
        </p>
        <ul class="fl-checks">
          <li>Padrão claro para toda a equipe.</li>
          <li>Recursos integrados, sem excesso.</li>
          <li>Flexibilidade para evoluir do seu jeito.</li>
        </ul>
      </div>
    </section>

    <section class="sk-section" aria-labelledby="sk-contract">
      <p class="fl-eyebrow">O contrato</p>
      <h2 id="sk-contract">Um schema, usado quatro vezes</h2>
      <p class="sk-section__lede">O contrato é escrito uma vez, com TypeBox ou Zod, e o framework o usa em cada etapa da requisição.</p>
      <ol class="fl-steps">
        <li v-for="(step, i) in contract" :key="step.title" class="fl-card">
          <span class="fl-steps__n" aria-hidden="true">{{ i + 1 }}</span>
          <h3>{{ step.title }}</h3>
          <p>{{ step.text }}</p>
        </li>
      </ol>
    </section>

    <section class="sk-section" aria-labelledby="sk-included">
      <p class="fl-eyebrow">De fábrica</p>
      <h2 id="sk-included">O que já vem no lugar</h2>
      <dl class="fl-included">
        <div v-for="item in included" :key="item.term" class="fl-card">
          <dt>{{ item.term }}</dt>
          <dd>{{ item.text }}</dd>
        </div>
      </dl>
    </section>

    <section class="sk-section sk-section--last" aria-labelledby="sk-before">
      <div class="fl-notice">
        <p class="fl-eyebrow fl-eyebrow--violet">Antes de adotar</p>
        <h2 id="sk-before">O que o FlowingTS exige do seu projeto</h2>
        <dl class="fl-constraints">
          <div v-for="c in constraints" :key="c.term">
            <dt>{{ c.term }}</dt>
            <dd>{{ c.text }}</dd>
          </div>
        </dl>
      </div>
      <ul class="fl-pills" aria-label="Tecnologias">
        <li v-for="pill in pills" :key="pill">{{ pill }}</li>
      </ul>
      <p class="sk-section__more">
        <a :href="withBase('/guia/instalacao')">Requisitos e instalação</a>
        <a :href="withBase('/guia/exemplos')">Exemplos completos</a>
      </p>
    </section>
  </div>
</template>

<style scoped>
/*
 * O cenário (fundo, brilhos e ondas) é do layout inteiro da página inicial, no style.css (.fl-home-page), para
 * cobrir também o cabeçalho e o rodapé do VitePress. Aqui ficam só as cores do texto, sempre no modo escuro.
 */
.sk-home {
  --sk-gutter: clamp(16px, 4vw, 48px);
  --vp-c-text-1: var(--fl-cloud);
  --vp-c-text-2: #94a3b8;
  --vp-c-brand-1: var(--fl-cyan);
  --vp-c-divider: var(--fl-border);
  position: relative;
  color: var(--fl-cloud);
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

/* As seções ficam sobre o cenário da página; os cards são vidro fosco sobre as ondas. */
.sk-section {
  max-width: 1152px;
  margin: 0 auto;
  padding: clamp(56px, 8vw, 96px) var(--sk-gutter) 0;
}
.sk-section--last {
  padding-bottom: clamp(64px, 9vw, 112px);
}
.sk-section h2 {
  margin: 0;
  font-size: clamp(1.6rem, 2.8vw, 2.1rem);
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.018em;
  color: var(--fl-cloud);
}
.sk-section__lede {
  margin: 12px 0 0;
  max-width: 62ch;
  color: #94a3b8;
  line-height: 1.7;
}
.fl-eyebrow {
  margin: 0 0 12px;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fl-cyan);
}
.fl-eyebrow--violet {
  color: #a78bfa;
}

/* Superfície comum dos cards. */
.fl-card,
.fl-pillars,
.fl-notice {
  border: 1px solid var(--fl-border);
  border-radius: 14px;
  background: rgba(18, 27, 43, 0.72);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.fl-card {
  padding: 22px 22px 20px;
  transition: border-color 0.2s ease, transform 0.2s ease;
}
.fl-card:hover {
  border-color: rgba(34, 211, 238, 0.45);
  transform: translateY(-2px);
}

/* Os quatro pilares num painel só, separados por divisórias, como no guia de identidade. */
.fl-pillars {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}
.fl-pillars li {
  padding: 28px 26px;
}
.fl-pillars li + li {
  border-left: 1px solid var(--fl-border);
}
.fl-pillars svg {
  color: var(--fl-cyan);
}
.fl-pillars h3 {
  margin: 14px 0 6px;
  font-size: 1.08rem;
  font-weight: 600;
  color: var(--fl-cloud);
}
.fl-pillars p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: #94a3b8;
}

/* O problema: a frase à esquerda, a resposta à direita, com uma divisória entre elas. */
.fl-problem {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: clamp(32px, 5vw, 64px);
  align-items: center;
}
.fl-problem h2 {
  font-size: clamp(1.6rem, 3vw, 2.25rem);
  line-height: 1.2;
}
.fl-problem__answer {
  padding-left: clamp(0px, 4vw, 48px);
  border-left: 1px solid var(--fl-border);
}
.fl-problem__answer p {
  margin: 0;
  line-height: 1.75;
  color: #cbd5e1;
}
.fl-checks {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}
.fl-checks li {
  position: relative;
  padding-left: 30px;
  margin-top: 10px;
  color: var(--fl-cloud);
}
.fl-checks li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 0.35em;
  width: 14px;
  height: 8px;
  border-left: 2px solid var(--fl-cyan);
  border-bottom: 2px solid var(--fl-cyan);
  transform: rotate(-45deg);
}

/* O contrato em quatro passos numerados. */
.fl-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
}
.fl-steps__n {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--fl-cyan);
  color: var(--fl-midnight);
  font-size: 0.9rem;
  font-weight: 700;
}
.fl-steps h3 {
  margin: 14px 0 6px;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--fl-cloud);
}
.fl-steps p {
  margin: 0;
  font-size: 0.94rem;
  line-height: 1.6;
  color: #94a3b8;
}

.fl-included {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin: 32px 0 0;
}
.fl-included dt {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--fl-cloud);
}
.fl-included dt::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 10px;
  border-radius: 50%;
  background: var(--fl-gradient);
  vertical-align: 0.1em;
}
.fl-included dd {
  margin: 8px 0 0;
  font-size: 0.94rem;
  line-height: 1.6;
  color: #94a3b8;
}

/* Antes de adotar: o mesmo vidro, com a borda e o título em violeta para se destacar dos recursos. */
.fl-notice {
  padding: clamp(28px, 4vw, 40px);
  border-color: rgba(139, 92, 246, 0.4);
  background:
    linear-gradient(135deg, rgba(139, 92, 246, 0.1), transparent 60%),
    rgba(18, 27, 43, 0.75);
}
.fl-constraints {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px 40px;
  margin: 28px 0 0;
}
.fl-constraints div {
  padding-left: 16px;
  border-left: 2px solid rgba(139, 92, 246, 0.6);
}
.fl-constraints dt {
  font-weight: 600;
  color: var(--fl-cloud);
}
.fl-constraints dd {
  margin: 6px 0 0;
  font-size: 0.94rem;
  line-height: 1.6;
  color: #94a3b8;
}

/* As pílulas de tecnologia. */
.fl-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
}
.fl-pills li {
  padding: 9px 16px;
  border: 1px solid var(--fl-border);
  border-radius: 10px;
  background: rgba(18, 27, 43, 0.72);
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--fl-cloud);
}

.sk-section__more {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin: 28px 0 0;
}
.sk-section__more a {
  font-weight: 500;
  color: var(--fl-cyan);
  text-decoration: none;
}
.sk-section__more a:hover {
  text-decoration: underline;
}

@media (max-width: 960px) {
  .fl-pillars,
  .fl-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .fl-pillars li:nth-child(3) {
    border-left: none;
  }
  .fl-pillars li:nth-child(n + 3) {
    border-top: 1px solid var(--fl-border);
  }
  .fl-included {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .fl-problem {
    grid-template-columns: minmax(0, 1fr);
  }
  .fl-problem__answer {
    padding-left: 0;
    border-left: none;
  }
}
@media (max-width: 640px) {
  .fl-pillars,
  .fl-steps,
  .fl-included,
  .fl-constraints {
    grid-template-columns: minmax(0, 1fr);
  }
  .fl-pillars li + li {
    border-left: none;
    border-top: 1px solid var(--fl-border);
  }
  .fl-window pre {
    padding: 18px 16px 20px;
    font-size: 0.8rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .fl-card {
    transition: none;
  }
  .fl-card:hover {
    transform: none;
  }
}
</style>
