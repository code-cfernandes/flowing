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

title "CRUD · buscar por id"
req "$BASE/users/$ID"

title "CRUD · atualizar parcialmente (PATCH)"
req -XPATCH "$BASE/users/$ID" "${JSON[@]}" -d '{"name":"Ana Maria"}'

title "CRUD · saudação async medida com @timer() (veja o log do servidor)"
req -XPOST "$BASE/users/$ID/greet" "${JSON[@]}" -d '{}'

title "B-02 · validação com detalhes por campo"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":"","email":"nao-e-email"}'

title "S-07 · campo extra no body é rejeitado (mass assignment)"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":"Eve","email":"eve@example.com","role":"admin"}'

title "B-06 · body sem coerção: limit numérico ok na query, mas string no body falha"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":123,"email":"x@example.com"}'

title "Params · id que não é UUID (400)"
req "$BASE/users/123"

title "Regra de negócio · e-mail duplicado (400)"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{"name":"Outra","email":"ana@example.com"}'

title "B-01 · JSON malformado (400)"
req -XPOST "$BASE/users" "${JSON[@]}" -d '{oops'

title "B-12 · payload acima de 64KB (413 + Connection: close)"
BIG=$(head -c 70000 /dev/zero | tr '\0' a)
curl -s -D - -o /dev/null -XPOST "$BASE/users" "${JSON[@]}" -d "{\"name\":\"$BIG\"}" | grep -iE '^HTTP|^connection'

title "F-08 · HEAD (sem corpo) e OPTIONS automático"
HDR_FILTER='^HTTP|^content-length|^allow' hdrs -I "$BASE/users/$ID"
HDR_FILTER='^HTTP|^allow' hdrs -XOPTIONS "$BASE/users/$ID"

title "405 · método não suportado"
req -XPUT "$BASE/users"

title "S-04 · headers de segurança em toda resposta"
HDR_FILTER='^x-content|^content-security|^referrer|^x-frame|^cross-origin' hdrs "$BASE/health"

title "S-01 · CORS preflight de origem permitida"
HDR_FILTER='^HTTP|^access-control|^vary' hdrs -XOPTIONS "$BASE/users" \
  -H "origin: $ORIGIN_OK" -H 'access-control-request-method: POST' -H 'access-control-request-headers: content-type'

title "S-01 · CORS de origem desconhecida (sem Access-Control-Allow-Origin)"
HDR_FILTER='^HTTP|^access-control' hdrs -XOPTIONS "$BASE/users" \
  -H 'origin: https://atacante.com' -H 'access-control-request-method: POST'
echo "(nenhum header access-control acima = bloqueado pelo navegador)"

title "B-09 · herança: /health na base e em /admin/health"
req "$BASE/health"
req "$BASE/admin/health"

title "B-03 · header obrigatório ausente (400) / chave errada (401) / ok (200)"
req "$BASE/admin/stats"
req "$BASE/admin/stats" -H 'x-api-key: chave-errada'
req "$BASE/admin/stats" -H "x-api-key: ${ADMIN_API_KEY:-dev-admin-key}"

title "S-05 · erro interno não vaza detalhes (o log do servidor mostra o erro real)"
req "$BASE/admin/boom"

title "CRUD · remover (204) e confirmar (404)"
req -XDELETE "$BASE/users/$ID"
req "$BASE/users/$ID"

title "S-06 · rate limit (o servidor precisa ter subido com RATE_LIMIT baixo, ex.: RATE_LIMIT=5)"
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code} " "$BASE/health"; done; echo
