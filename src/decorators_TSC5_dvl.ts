

//https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/#decorators

/*
Working on new decorator implemenation sandbox

*/
function loggedMethod(originalMethod: any, context: ClassMethodDecoratorContext) {
  const methodName = String(context.name);

  function replacementMethod(this: any, ...args: any[]) {
      console.log(`LOG: Entering method '${methodName}'.`)
      const result = originalMethod.call(this, ...args);
      console.log(`LOG: Exiting method '${methodName}'.`)
      return result;
  }

  return replacementMethod;
}

class Person {
  name: string;
  constructor(name: string) {
      this.name = name;
  }
//  @loggedMethod // SHUT DOWN experimental decorator in tsconfig to start working on this
  greet(){
      console.log(`Hello, my name is ${this.name}.`);
  };
}
