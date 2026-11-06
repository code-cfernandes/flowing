import { type Guard, unauthorized } from "picodecor";

const API_KEY = process.env.ADMIN_API_KEY ?? 'dev-admin-key';

// Guard (F-01): roda antes da validação, então sem a chave a resposta é 401 e não um 400 que revele o schema
export const apiKeyGuard: Guard = (ctx) => {
  if (ctx.get('x-api-key') !== API_KEY) throw unauthorized('invalid api key');
  return true;
};
