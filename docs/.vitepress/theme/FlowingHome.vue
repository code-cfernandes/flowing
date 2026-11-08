<script setup lang="ts">
import { ref } from 'vue';
import { withBase } from 'vitepress';

const installCommand = 'pnpm add flowingts';

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
          <p class="sk-mark"><span>Flowing</span><span lang="ja" class="sk-mark__ja">刺し子</span></p>
          <h1 id="sk-title" class="sk-title">Framework HTTP para Node.js com um contrato em cada rota.</h1>
          <p class="sk-lede">
            Decorators padrão organizam as rotas. O schema de cada uma valida a entrada, filtra a resposta, tipa o
            <code>ctx</code> e gera o OpenAPI. Segurança, shutdown e observabilidade já vêm ligados.
          </p>
          <div class="sk-actions">
            <a class="sk-button" :href="withBase('/guia/introducao')">Ler o guia</a>
            <button type="button" class="sk-install" :aria-label="`Copiar o comando ${installCommand}`" @click="copyInstall">
              <code>{{ installCommand }}</code>
              <span class="sk-install__state" aria-live="polite">{{ copied ? 'Copiado' : 'Copiar' }}</span>
            </button>
          </div>
        </div>

        <div class="sk-code-wrap">
        <div class="sk-glow" aria-hidden="true"></div>
        <figure class="sk-code" aria-label="Exemplo de rota com schema">
          <pre><code><span class="t-k">const</span> create = {
  body: Type.<span class="t-f">Object</span>({
    name: Type.<span class="t-f">String</span>({ minLength: <span class="t-n">1</span> }),
  }),
  response: { <span class="t-n">201</span>: User },
} <span class="t-k">satisfies</span> RouteSchemas;

<span class="sk-stitch">@<span class="t-f">Router</span>(<span class="t-s">'/users'</span>)</span>
<span class="t-k">class</span> UserRoutes {
  <span class="sk-stitch">@<span class="t-f">Post</span>(<span class="t-s">'/'</span>, create)</span>
  <span class="t-f">create</span>(ctx: Context&lt;<span class="t-k">typeof</span> create&gt;) {
    <span class="t-k">return</span> { id: <span class="t-f">randomUUID</span>(), ...ctx.body };
  }
}</code></pre>
          <figcaption>Os decorators são os pontos: organizam a classe e prendem o contrato à rota.</figcaption>
        </figure>
        </div>
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
.sk-home {
  --sk-gutter: clamp(16px, 4vw, 48px);
}

/*
 * Fundo do herói (camada 1 da identidade v2): azul-meia-noite com dois brilhos difusos, ciano e violeta, e o feixe
 * de ondas em linhas finas que atravessa a página.
 */
.sk-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  color: var(--fl-cloud);
  background-color: var(--fl-midnight);
  background-image:
    radial-gradient(60% 70% at 85% 10%, rgba(34, 211, 238, 0.16), transparent 70%),
    radial-gradient(50% 60% at 10% 90%, rgba(139, 92, 246, 0.14), transparent 70%);
}

/* O feixe de ondas: um SVG de linhas finas, fixo atrás do conteúdo, com um esmaecimento nas bordas. */
.sk-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: url('/flow-waves.svg') center / cover no-repeat;
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 18%, #000 85%, transparent 100%);
  mask-image: linear-gradient(180deg, transparent 0%, #000 18%, #000 85%, transparent 100%);
}

/* Uma grade em perspectiva quase invisível, só na base, como o piso por onde o fluxo passa. */
.sk-hero::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 40%;
  z-index: -2;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
  background-size: 48px 48px;
  transform: perspective(600px) rotateX(55deg);
  transform-origin: bottom;
  -webkit-mask-image: linear-gradient(0deg, #000, transparent);
  mask-image: linear-gradient(0deg, #000, transparent);
}

.sk-hero__inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: clamp(48px, 9vw, 112px) var(--sk-gutter) clamp(48px, 8vw, 96px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  gap: clamp(32px, 5vw, 72px);
  align-items: center;
}
.sk-mark {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 0 0 20px;
  font-size: 1.05rem;
  font-weight: 700;
}
.sk-mark__ja {
  font-weight: 400;
  opacity: 0.7;
}
.sk-title {
  margin: 0;
  max-width: 20ch;
  text-wrap: balance;
  font-size: clamp(2.1rem, 4.4vw, 3.3rem);
  line-height: 1.12;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.sk-lede {
  margin: 24px 0 0;
  max-width: 52ch;
  font-size: 1.12rem;
  line-height: 1.7;
  color: rgba(238, 241, 245, 0.86);
}
.sk-lede code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.92em;
  color: var(--sk-thread);
}
.sk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}
.sk-button,
.sk-install {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  min-height: 46px;
  padding: 0 20px;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  text-decoration: none;
}
.sk-button {
  background: var(--sk-thread);
  color: var(--sk-indigo);
}
.sk-button:hover {
  background: #ffffff;
}
.sk-install {
  background: transparent;
  color: var(--sk-thread);
  border: 2px dashed rgba(238, 241, 245, 0.55);
  cursor: pointer;
}
.sk-install:hover {
  border-color: var(--sk-thread);
}
.sk-install code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.95rem;
  background: none;
  color: inherit;
  padding: 0;
}
.sk-install__state {
  font-size: 0.85rem;
  opacity: 0.75;
  min-width: 6ch;
}
.sk-button:focus-visible,
.sk-install:focus-visible {
  outline: 3px solid var(--sk-indigo-faded);
  outline-offset: 3px;
}

/* O código sobre o tecido; as linhas de decorator recebem o ponto corrido. */
.sk-code-wrap {
  position: relative;
}
/* Luz fixa que sai de baixo da caixa de código, refletida no metal. */
.sk-glow {
  position: absolute;
  left: 2%;
  right: 2%;
  bottom: -30%;
  height: 58%;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 35%, rgba(170, 200, 250, 0.62), rgba(120, 160, 230, 0.24) 42%, transparent 70%);
  filter: blur(30px);
}
.sk-code {
  position: relative;
  margin: 0;
  /* Filete de luz na borda, mais forte no canto de cima, como vidro sobre o tecido. */
  border: 1px solid transparent;
  background:
    linear-gradient(rgba(14, 21, 40, 0.8), rgba(14, 21, 40, 0.8)) padding-box,
    linear-gradient(150deg, rgba(220, 230, 245, 0.55), rgba(220, 230, 245, 0.08) 35%, rgba(220, 230, 245, 0.04) 70%, rgba(220, 230, 245, 0.22)) border-box;
  border-radius: 10px;
  /* Vidro fosco: a luz do tecido atravessa o bloco, sem atrapalhar a leitura. */
  -webkit-backdrop-filter: blur(10px) saturate(1.2);
  backdrop-filter: blur(10px) saturate(1.2);
  box-shadow:
    0 24px 48px -20px rgba(4, 8, 20, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.sk-code pre {
  margin: 0;
  padding: 24px 24px 20px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 0.86rem;
  line-height: 1.75;
  color: #d5deeb;
}
.sk-code figcaption {
  padding: 0 24px 20px;
  font-size: 0.86rem;
  color: rgba(238, 241, 245, 0.62);
}
.t-k { color: #9dbbe0; }
.t-f { color: #f0d9a8; }
.t-s { color: #b8d8b0; }
.t-n { color: #e7b7a0; }

.sk-stitch {
  position: relative;
  color: var(--sk-thread);
}
.sk-stitch::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -4px;
  height: 2px;
  /* Linha de prata (gin-ito): o ponto corrido recortado de um degradê metálico. */
  background: linear-gradient(90deg, #b9c6da 0%, #eef2f8 30%, #ffffff 42%, #9fb1cc 55%, #dfe6f1 75%, #b9c6da 100%);
  background-size: 300% 100%;
  background-position: 100% 0;
  -webkit-mask: repeating-linear-gradient(90deg, #000 0 5px, transparent 5px 9px);
  mask: repeating-linear-gradient(90deg, #000 0 5px, transparent 5px 9px);
  /* A costura passa uma vez, e depois o reflexo da prata corre uma vez pela linha. */
  clip-path: inset(0 100% 0 0);
  animation:
    sk-sew 900ms cubic-bezier(0.6, 0, 0.3, 1) forwards,
    sk-sheen 1400ms ease-in-out 1100ms forwards;
}
.sk-stitch:nth-of-type(2)::after {
  animation-delay: 450ms, 1550ms;
}
@keyframes sk-sew {
  to {
    clip-path: inset(0 0 0 0);
  }
}
@keyframes sk-sheen {
  to {
    background-position: 0% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk-stitch::after {
    animation: none;
    clip-path: none;
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
  font-weight: 700;
  letter-spacing: -0.015em;
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
:global(.dark .sk-patch) {
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
  font-weight: 700;
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
  font-weight: 700;
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
:global(.dark .sk-notice) {
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
  font-weight: 700;
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
  .sk-code pre {
    padding: 20px 16px 16px;
    font-size: 0.78rem;
  }
  .sk-code figcaption {
    padding: 0 16px 16px;
  }
  .sk-thread,
  .sk-included {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
