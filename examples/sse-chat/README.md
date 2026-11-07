# Chat com Server-Sent Events

Uma sala de chat: `POST /chat/messages` envia, e `GET /chat/events` (um `EventSource` no navegador) recebe.

- **`ctx.sse()`:** abre a conexão, com um comentário de keep-alive a cada 15 s para proxies não derrubarem a conexão ociosa.
- **Reconexão:** o navegador reconecta sozinho com o `Last-Event-ID`, e o hub reenvia só as mensagens perdidas.
- **Limpeza:** o `onClose` tira a conexão da sala quando o cliente sai ou o app encerra. No `close()` do app, os streams abertos são cancelados primeiro.

```bash
pnpm exec tsx examples/sse-chat/server.ts
curl -N localhost:3000/chat/events        # num terminal
curl -X POST localhost:3000/chat/messages -H 'content-type: application/json' -d '{"author":"ana","text":"oi"}'
```

Testes (com rede real): `node --import tsx --test examples/sse-chat/app.test.ts`.
