---
layout: home

hero:
  name: Sashiko
  text: Micro-framework HTTP para Node.js
  tagline: Decorators TC39 nativos, schema-first e seguro por padrão.
  actions:
    - theme: brand
      text: Começar
      link: /guia/introducao
    - theme: alt
      text: Instalação
      link: /guia/instalacao
    - theme: alt
      text: GitHub
      link: https://github.com/code-cfernandes/sashiko

features:
  - title: Decorators padrão
    details: '@Router, @Get e @Post com os decorators do TC39, sem reflect-metadata nem experimentalDecorators.'
  - title: Schema-first
    details: Um schema TypeBox valida a entrada, serializa a resposta, filtra campos e tipa o ctx.
  - title: Seguro por padrão
    details: Headers de segurança, limites de body, timeouts, validação de Host, CSRF e shutdown gracioso já ligados.
  - title: Composição explícita
    details: app.mount() e app.group() com prefixos, middlewares, guards e virtual hosts, sem container de DI.
  - title: Pronto para produção
    details: Healthchecks, HTTPS com troca de certificado, OpenAPI e /docs, logs com redact e streaming com cancelamento.
  - title: Observabilidade nativa
    details: OpenTelemetry por injeção, ctx.route com o template da rota, hooks que rodam exatamente uma vez.
---
