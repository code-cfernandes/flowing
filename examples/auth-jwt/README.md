# Autenticação com JWT

Login com senha (hash `scrypt`), token JWT HS256 e rotas protegidas pelo `bearerAuth` do FlowingTS.

- **`POST /auth/login`:** devolve o token. E-mail inexistente e senha errada recebem a mesma resposta, para não revelar quem tem conta.
- **`@Guards(bearerAuth(...))` na classe:** protege todas as rotas de `/me`. O usuário do token fica em `ctx.state.user`.
- **`@Guards(isAdmin)` num método:** um guard de papel; quem não é admin recebe 403.
- **Verificação do token:** recusa assinatura inválida, outro algoritmo (inclusive `alg: none`), outra chave e token expirado.

O `jwt.ts` tem uma implementação mínima com `node:crypto`, para o exemplo não depender de biblioteca. Em produção, use uma biblioteca mantida, como a `jose`.

```bash
JWT_SECRET="$(openssl rand -hex 32)" pnpm exec tsx examples/auth-jwt/server.ts
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana@exemplo.com","password":"senha-da-ana"}' | jq -r .token)
curl localhost:3000/me -H "authorization: Bearer $TOKEN"
curl localhost:3000/me/admin/report -H "authorization: Bearer $TOKEN"
```

Testes: `node --import tsx --test examples/auth-jwt/app.test.ts`.
