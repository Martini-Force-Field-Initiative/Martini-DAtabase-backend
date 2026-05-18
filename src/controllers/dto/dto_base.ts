export const castStringTrueFalseToBoolean = (val: string|boolean|number) : boolean | undefined => {
    //Don't work with 0 and 1
    if (typeof(val) === "boolean")
        return val;
    if (typeof(val) === "number")
        return val === 1;
    if(val.toLowerCase() === "true") return true
    if(val.toLowerCase() === "false") return false
}


interface Metadata {
comments:string,
cite:string
}

export interface MetadataCollection {
[key: string]: Metadata
}