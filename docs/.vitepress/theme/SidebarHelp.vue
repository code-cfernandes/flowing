<script setup lang="ts">
import { useData, withBase } from 'vitepress';

const { theme } = useData();
</script>

<template>
  <div class="fl-help">
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2Zm0 0v14" /></svg>
    <div>
      <p class="fl-help__title">Precisando de ajuda?</p>
      <p class="fl-help__text">
        Veja os <a :href="withBase('/guia/exemplos')">exemplos completos</a> ou abra uma
        <a :href="theme.repo + '/issues'">issue no GitHub</a>.
      </p>
    </div>
  </div>
</template>

<style scoped>
.fl-help {
  display: flex;
  gap: 12px;
  margin: 24px 0 32px;
  padding: 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: linear-gradient(135deg, var(--vp-c-brand-soft), transparent 70%), var(--vp-c-bg-soft);
}
.fl-help svg {
  flex: none;
  color: var(--vp-c-brand-1);
}
.fl-help__title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.fl-help__text {
  margin: 4px 0 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
.fl-help__text a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.fl-help__text a:hover {
  text-decoration: underline;
}
</style>
