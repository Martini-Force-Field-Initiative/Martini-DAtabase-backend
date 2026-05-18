/* Constrained Partials from https://stackoverflow.com/questions/59845907/partial-on-specific-key
* type TestPartialK = PartialK<{ a: string, b: number, c: boolean }, "b" | "c">
# type TestPartialK = {
#    b?: number | undefined;
#    c?: boolean | undefined;
#    a: string;
# }
type Foo = NestedPartialK<FooDatabase, "_id">
# type Foo = {
#    _id?: string | undefined;
#    foo: string;
#    bar: string;
#    tree: {
#        _id?: string | undefined;
#        again: {
#            _id?: string | undefined;
#            value: string;
#        };
#    };
#}
*/

/**
 * A map with primary key that must be part of a set
 */
// TO DO


/* Merge two interfaces with predence for keys on the 2ndone */
export type MergeRightPrio<T, R> = Omit<T, keyof R> & R;
/** PartialK<T, K> acts like Partial<T> but only for the keys in K, 
*leaving the rest alone. So PartialK<T, keyof T> or PartialK<T, PropertyKey> 
* should act like Partial<T>
*/
export type PartialK<T, K extends PropertyKey = PropertyKey> =
    Partial<Pick<T, Extract<keyof T, K>>> & Omit<T, K> extends infer O ?
    { [P in keyof O]: O[P] } : never;
/** It uses PartialK in its definition; it leaves functions and primitives alone, 
 * and uses recursive types to map arrays to arrays, and objects to objects.
 *  Note that it doesn't iterate tuples
 */
export type NestedPartialK<T, K extends PropertyKey = PropertyKey> =
    T extends Function ? T :
    T extends Array<any> ? Array<NestedPartialK<T[number], K>> :
    T extends object ? PartialK<{ [P in keyof T]: NestedPartialK<T[P], K> }, K> :
    T;

/** A type that contains keys common to A and B
* https://stackoverflow.com/questions/47375916/typescript-how-to-create-type-with-common-properties-of-two-types
*/
export type CommonKeyAndType<A, B> = {
    [K in keyof A & keyof B]:
    A[K] extends B[K] // Basic check for simplicity here.
    ? A[K] // Value becomes same as key
    : never // Or `never` if check did not pass
}

/** A type that  contains keys common to A and B and possibly diufferent value types
*/
export type CommonKeyAndAny<A, B> = {
    [K in keyof A & keyof B]: A[K] | B[K]
}

/**
 * Omits properties that have type `never`. Utilizes key-remapping introduced in
 * TS4.1.
 *
 * @example
 * ```ts
 * type A = { x: never; y: string; }
 * OmitNever<A> // => { y: string; }
 * ```
 */
type OmitNever<T extends Record<string, unknown>> = {
    [K in keyof T as T[K] extends never ? never : K]: T[K];
  };
  
  /**
   * Constructs a Record type that only includes shared properties between `A` and
   * `B`. If the value of a key is different in `A` and `B`, `SharedProperties<A,
   * B>` attempts to choose a type that is assignable to the types of both values.
   *
   * Note that this is NOT equivalent to `A & B`.
   *
   * @example
   * ```ts
   * type A = { x: string; y: string; }
   * type B = { y: string; z: string }
   * type C = { y: string | number; }
   *
   * A & B                  // => { x: string; y: string; z: string; }
   * SharedProperties<A, B> // => { y: string; }
   * SharedProperties<B, C> // => { y: string | number; }
   * ```
   */
  
  export type SharedProperties<A, B> = OmitNever<Pick<A & B, keyof A & keyof B>>;

/**
 * If only certain '_id' fields should be optional, we define a new utility type, that only declares the selected keys as optional
 * @example
 * type Optional<T, K extends keyof T> = Partial<Pick<T, K>> & Omit<T, K>
 * interface FooDatabase {
 * _id: number;
 * foo: string;
 * bar: string;
 * }
 * type Foo = Optional<FooDatabase, '_id'>
 */
  export type Optional<T, K extends keyof T> = Partial<Pick<T, K>> & Omit<T, K>