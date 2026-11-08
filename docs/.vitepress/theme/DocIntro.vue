<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';

/**
 * Antes do conteúdo de cada página: a trilha (Início › grupo › página), tirada da própria barra lateral.
 */
const { page, theme } = useData();

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
</script>

<template>
  <nav v-if="trail.length" class="fl-trail" aria-label="Você está em">
    <a :href="withBase('/')" aria-label="Início">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7M5 10v10h14V10" /></svg>
    </a>
    <span v-for="(t, i) in trail" :key="i" :aria-current="i === trail.length - 1 ? 'page' : undefined">{{ t }}</span>
  </nav>
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

</style>
