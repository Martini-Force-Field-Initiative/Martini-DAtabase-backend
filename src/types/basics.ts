export const isString = (o:unknown): o is string => {
    return typeof o === "string";
};
export const nullOrString = (str?: string | null) => {
    if (!str || str === undefined || str === null || str === 'null') {
      return null;
    }
    return typeof str === 'string' ? str : undefined;
  };
