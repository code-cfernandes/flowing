<script setup lang="ts">
import { computed, ref } from 'vue';
import { useData, withBase } from 'vitepress';

/**
 * Abaixo de "Nesta página": os comandos do dia a dia, com botão de copiar, e as outras páginas do mesmo grupo da
 * barra lateral, como no protótipo da documentação.
 */
const { page, theme } = useData();

const commands = [
  { label: 'instalar', cmd: 'npm install flowingts' },
  { label: 'desenvolver', cmd: 'npx tsx watch src/server.ts' },
  { label: 'compilar', cmd: 'npx tsc' },
  { label: 'rodar', cmd: 'node dist/server.js' },
];
const copied = ref('');
async function copy(cmd: string) {
  try {
    await navigator.clipboard.writeText(cmd);
    copied.value = cmd;
    setTimeout(() => (copied.value = ''), 1600);
  } catch {
    copied.value = '';
  }
}

type Item = { text?: string; link?: string; items?: Item[] };
const related = computed(() => {
  const path = ('/' + page.value.relativePath.replace(/(index)?\.md$/, '')).replace(/\/$/, '');
  const sidebar = theme.value.sidebar as Record<string, Item[]> | undefined;
  const key = sidebar && Object.keys(sidebar).find((k) => path.startsWith(k.replace(/\/$/, '')));
  if (!sidebar || !key) return [];
  for (const group of sidebar[key] ?? []) {
    const items = group.items ?? [];
    if (items.some((i) => i.link?.replace(/\/$/, '') === path)) {
      return items.filter((i) => i.link && i.link.replace(/\/$/, '') !== path).slice(0, 4);
    }
  }
  return [];
});
</script>

<template>
  <section class="fl-aside" aria-labelledby="fl-aside-cmd">
    <p id="fl-aside-cmd" class="fl-aside__title">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4zM8 10l2 2-2 2M12 15h4" /></svg>
      Comandos úteis
    </p>
    <ul class="fl-cmds">
      <li v-for="c in commands" :key="c.cmd">
        <button type="button" :aria-label="`Copiar: ${c.cmd}`" @click="copy(c.cmd)">
          <code><span>{{ c.cmd.split(' ')[0] }}</span> {{ c.cmd.split(' ').slice(1).join(' ') }}</code>
          <span class="fl-cmds__state" aria-live="polite">{{ copied === c.cmd ? 'copiado' : '' }}</span>
        </button>
      </li>
    </ul>
  </section>

  <section v-if="related.length" class="fl-aside" aria-labelledby="fl-aside-see">
    <p id="fl-aside-see" class="fl-aside__title">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
      Veja também
    </p>
    <ul class="fl-see">
      <li v-for="r in related" :key="r.link">
        <a :href="withBase(r.link!)">{{ r.text }}<span aria-hidden="true">→</span></a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.fl-aside {
  margin-top: 20px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-alt);
}
.fl-aside__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.fl-aside__title svg {
  color: var(--vp-c-brand-1);
}
.fl-cmds,
.fl-see {
  margin: 0;
  padding: 0;
  list-style: none;
}
.fl-cmds li + li {
  margin-top: 6px;
}
.fl-cmds button {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  text-align: left;
  cursor: pointer;
}
.fl-cmds button:hover {
  border-color: var(--vp-c-brand-1);
}
.fl-cmds code {
  flex: 1;
  font-family: var(--vp-font-family-mono);
  font-size: 0.76rem;
  color: var(--vp-c-text-1);
  overflow-wrap: anywhere;
}
.fl-cmds code span {
  color: #e879f9;
}
:root:not(.dark) .fl-cmds code span {
  color: #a21caf;
}
.fl-cmds__state {
  font-size: 0.7rem;
  color: var(--vp-c-brand-1);
}
.fl-see li + li {
  border-top: 1px solid var(--vp-c-divider);
}
.fl-see a {
  display: flex;
  justify-content: space-between;
  padding: 8px 2px;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  text-decoration: none;
}
.fl-see a span {
  color: var(--vp-c-brand-1);
}
.fl-see a:hover {
  color: var(--vp-c-text-1);
}
</style>
