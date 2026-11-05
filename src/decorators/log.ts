export function timer<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
) {
  const methodName = String(context.name);

  return function (this: This, ...args: Args): Return {
    console.time(`→ Time in: '${methodName}'`);
    const result = target.call(this, ...args);
    console.timeEnd(`→ Time in: '${methodName}'`);
    // console.timeEnd(`← Saindo de '${methodName}'`);
    return result;
  };
}