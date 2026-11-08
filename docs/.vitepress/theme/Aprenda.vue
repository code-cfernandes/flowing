<script setup lang="ts">
/** O card "O que você vai aprender", escrito logo depois do título da página: `<Aprenda>…</Aprenda>`. */
</script>

<template>
  <aside class="fl-learn">
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
    <div>
      <p class="fl-learn__title">O que você vai aprender</p>
      <p class="fl-learn__text"><slot /></p>
    </div>
  </aside>
</template>

<style scoped>
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
