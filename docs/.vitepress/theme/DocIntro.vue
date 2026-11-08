<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useData, withBase } from 'vitepress';

/**
 * Antes do conteúdo de cada página: a trilha (Início › grupo › página), tirada da própria barra lateral, e o card
 * "O que você vai aprender", quando a página declara `aprenda` no frontmatter.
 */
const { page, theme, frontmatter } = useData();

type Item = { text?: string; link?: string; items?: Item[] };

const trail = computed(() => {
  const path = '/' + page.value.relativePath.replace(/(index)?\.md$/, '');
  const sidebar = theme.value.sidebar as Record<string, Item[]> | undefined;
  if (!sidebar) return [];
  const key = Object.keys(sidebar).find((k) => path.startsWith(k));
  if (!key) return [];
  for (const group of sidebar[key] ?? []) {
    const found = (group.items ?? []).find((i) => i.link && i.link.replace(/\/$/, '') === path.replace(/\/$/, ''));
    if (found) return [group.text ?? '', found.text ?? ''];
  }
  return [];
});

/*
 * O slot do tema fica acima do conteúdo; no protótipo, o card vem logo depois do título. Ao carregar cada página,
 * o card é levado para depois do h1 (o elemento continua sendo o mesmo que o Vue controla).
 */
const learn = ref<HTMLElement | null>(null);
function placeLearnCard() {
  const card = learn.value;
  const title = document.querySelector('.vp-doc h1');
  if (card && title && title.nextElementSibling !== card) title.after(card);
}
onMounted(placeLearnCard);
watch(
  () => page.value.relativePath,
  () => nextTick(placeLearnCard),
);
</script>

<template>
  <nav v-if="trail.length" class="fl-trail" aria-label="Você está em">
    <a :href="withBase('/')" aria-label="Início">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7M5 10v10h14V10" /></svg>
    </a>
    <span v-for="(t, i) in trail" :key="i" :aria-current="i === trail.length - 1 ? 'page' : undefined">{{ t }}</span>
  </nav>
  <aside v-if="frontmatter.aprenda" ref="learn" class="fl-learn">
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
    <div>
      <p class="fl-learn__title">O que você vai aprender</p>
      <p class="fl-learn__text">{{ frontmatter.aprenda }}</p>
    </div>
  </aside>
</template>

<style scoped>
.fl-trail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}
.fl-trail a {
  display: inline-flex;
  color: var(--vp-c-brand-1);
}
.fl-trail span::before {
  content: '›';
  margin-right: 8px;
  color: var(--vp-c-text-3);
}
.fl-trail span[aria-current] {
  color: var(--vp-c-text-1);
}

/* O card com a onda no canto: a mesma linha de fluxo da página inicial, em escala menor. */
.fl-learn {
  position: relative;
  display: flex;
  gap: 16px;
  margin: 20px 0 32px;
  padding: 20px 24px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 45%, transparent);
  border-radius: 14px;
  background: linear-gradient(135deg, var(--vp-c-brand-soft), transparent 65%), var(--vp-c-bg-alt);
}
.fl-learn::after {
  content: '';
  position: absolute;
  right: -40px;
  bottom: -30px;
  width: 360px;
  height: 140px;
  pointer-events: none;
  background: url('/flow-waves.svg') right bottom / 900px auto no-repeat;
  opacity: 0.7;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 60%);
  mask-image: linear-gradient(90deg, transparent, #000 60%);
}
.fl-learn > svg {
  flex: none;
  color: var(--vp-c-brand-1);
}
.fl-learn > div {
  position: relative;
  z-index: 1;
  max-width: 62ch;
}
.fl-learn__title {
  margin: 0;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.fl-learn__text {
  margin: 4px 0 0;
  font-size: 0.93rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}
</style>
