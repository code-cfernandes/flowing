// decorators/cors.ts
export function cors(
  origin: string,
  methods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
) {
  return function <This, Args extends [any, any], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
  ) {
    return function (this: This, ...args: Args): Return {
      const [, res] = args;
      // 1) seta ANTES de qualquer coisa
      if (res && !res.headersSent) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', methods);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        if (origin !== '*') res.setHeader('Vary', 'Origin');
      }
      // 2) preflight
      if (args[0]?.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return undefined as unknown as Return;
      }
      // 3) chama o original
      return target.call(this, ...args);
    };
  };
}