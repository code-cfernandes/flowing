<script setup lang="ts">
import { useData } from 'vitepress';

/** A versão do pacote, vinda do config (themeConfig.version), com o selo do estágio da API. */
const { theme } = useData();
const version: string = theme.value.version ?? '';
const stage = version.startsWith('0.') ? '0.x' : 'Estável';
</script>

<template>
  <div class="fl-version">
    <div class="fl-version__row">
      <span class="fl-version__number">v{{ version }}</span>
      <span class="fl-version__stage" :class="{ 'is-stable': stage === 'Estável' }">{{ stage }}</span>
    </div>
    <div class="fl-version__links">
      <a :href="theme.repo + '/blob/main/CHANGELOG.md'">Changelog</a>
      <a href="https://www.npmjs.com/package/flowingts">npm</a>
    </div>
  </div>
</template>

<style scoped>
.fl-version {
  margin: 20px 0 8px;
  padding: 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
.fl-version__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.fl-version__number {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--vp-c-text-1);
}
.fl-version__stage {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #a78bfa;
  background: rgba(139, 92, 246, 0.14);
  border: 1px solid rgba(139, 92, 246, 0.35);
}
:root:not(.dark) .fl-version__stage {
  color: var(--fl-violet-deep);
  background: rgba(109, 40, 217, 0.08);
  border-color: rgba(109, 40, 217, 0.3);
}
.fl-version__stage.is-stable {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.12);
  border-color: rgba(74, 222, 128, 0.35);
}
.fl-version__links {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  font-size: 0.82rem;
}
.fl-version__links a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}
.fl-version__links a:hover {
  color: var(--vp-c-brand-1);
}
</style>
