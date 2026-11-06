#!/usr/bin/env bash
# Percorre os cenários do exemplo app-users contra um servidor já rodando.
# Uso: pnpm dev   (em outro terminal)   e depois:   bash examples/app-users/scenarios.sh
set -u
BASE="${BASE:-http://127.0.0.1:3000}"
ORIGIN_OK="http://localhost:5173"
JSON=(-H 'content-type: application/json')

title() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
req()   { curl -s -w '  → [%{http_code}]\n' "$@"; echo; }
hdrs()  { curl -s -o /dev/null -D - "$@" | grep -iE "$HDR_FILTER"; }

title "CRUD · criar usuário (201)"
CREATED=$(curl -s -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":"Ana","email":"ana@example.com"}')
echo "$CREATED"
ID=$(echo "$CREATED" | sed -E 's/.*"id":"([^"]+)".*/\1/')

title "CRUD · listar com paginação (query coagida: limit=\"10\" → 10)"
req "$BASE/users?limit=10&offset=0"

title "Formatos · a mesma lista em CSV pelo Accept, e 406 para formato não oferecido"
curl -s -w '  → [%{http_code}] %{content_type}\n' "$BASE/users" -H 'accept: text/csv'
req "$BASE/users" -H 'accept: application/xml'

title "CRUD · buscar por id"
req "$BASE/users/$ID"

title "CRUD · atualizar parcialmente (PATCH)"
req -XPATCH "$BASE/users/$ID" "${JSON[@]}" -d '{"name":"Ana Maria"}'

title "CRUD · saudação async medida com @timer() (veja o log do servidor)"
req -XPOST "$BASE/users/$ID/greet" "${JSON[@]}" -d '{}'

title "Validação · erros com detalhes por campo (400)"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":"","email":"nao-e-email"}'

title "Validação · campo extra no body é rejeitado (mass assignment)"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":"Eve","email":"eve@example.com","role":"admin"}'

title "Validação · body sem coerção: número onde se espera texto falha (a query tem coerção)"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":123,"email":"x@example.com"}'

title "Validação · id que não é UUID (400)"
req "$BASE/users/123"

title "Erros · regra de negócio: e-mail duplicado (400)"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":"Outra","email":"ana@example.com"}'

title "Erros · JSON malformado (400)"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{oops'

title "Limites · payload acima de 64KB (413 + Connection: close)"
BIG=$(head -c 70000 /dev/zero | tr '\0' a)
curl -s -D - -o /dev/null -XPOST "$BASE/users" "${JSON[@]}" -d "{\"name\":\"$BIG\"}" | grep -iE '^HTTP|^connection'

title "Logs · cada resposta traz X-Request-Id (reaproveitado se enviado)"
HDR_FILTER='^x-request-id' hdrs "$BASE/health" -H 'x-request-id: meu-trace-123'

title "Rotas automáticas · HEAD (sem corpo) e OPTIONS"
HDR_FILTER='^HTTP|^content-length|^allow' hdrs -I "$BASE/users/$ID"
HDR_FILTER='^HTTP|^allow' hdrs -XOPTIONS "$BASE/users/$ID"

title "Rotas automáticas · método não suportado (405)"
req -XPUT "$BASE/users"

title "Segurança · headers de segurança em toda resposta"
HDR_FILTER='^x-content|^content-security|^referrer|^x-frame|^cross-origin' hdrs "$BASE/health"

title "Segurança · preflight CORS de origem permitida"
HDR_FILTER='^HTTP|^access-control|^vary' hdrs -XOPTIONS "$BASE/users" \
  -H "origin: $ORIGIN_OK" -H 'access-control-request-method: POST' -H 'access-control-request-headers: content-type'

title "Segurança · CORS de origem desconhecida (sem Access-Control-Allow-Origin)"
HDR_FILTER='^HTTP|^access-control' hdrs -XOPTIONS "$BASE/users" \
  -H 'origin: https://atacante.com' -H 'access-control-request-method: POST'
echo "(nenhum header access-control acima = bloqueado pelo navegador)"

title "Composição · herança: /health público; /admin/health herda a rota e recebe o guard"
req "$BASE/health"
req "$BASE/admin/health"
req "$BASE/admin/health" -H "x-api-key: ${ADMIN_API_KEY:-dev-admin-key}"

title "Composição · guard do mount: sem chave (401) / chave errada (401) / ok (200)"
req "$BASE/admin/stats"
req "$BASE/admin/stats" -H 'x-api-key: chave-errada'
req "$BASE/admin/stats" -H "x-api-key: ${ADMIN_API_KEY:-dev-admin-key}"

title "Erros · erro interno não vaza detalhes (o log do servidor mostra o erro real)"
req "$BASE/admin/boom" -H "x-api-key: ${ADMIN_API_KEY:-dev-admin-key}"

title "Composição · mesma classe em /public/users, só leitura (only), com cache"
CACHE_URL="$BASE/public/users?c=$RANDOM"   # URL única por execução: a 1ª é MISS e a 2ª é HIT
HDR_FILTER='^x-cache' hdrs "$CACHE_URL"
HDR_FILTER='^x-cache' hdrs "$CACHE_URL"
req "$BASE/public/users"
req -XPOST "$BASE/public/users" "${JSON[@]}" -d '{"name":"X","email":"x@example.com"}'

title "Mapeamento manual · /users/export.csv (só com a API key) e alias /users/by-id/:id"
req "$BASE/users/export.csv"
curl -s -w '  → [%{http_code}]\n' "$BASE/users/export.csv" -H "x-api-key: ${ADMIN_API_KEY:-dev-admin-key}"; echo
req "$BASE/users/by-id/$ID"

title "CRUD · remover (204) e confirmar (404)"
req -XDELETE "$BASE/users/$ID"
req "$BASE/users/$ID"

title "Limites · rate limit (suba o servidor com RATE_LIMIT baixo, ex.: RATE_LIMIT=5)"
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code} " "$BASE/health"; done; echo
