import "reflect-metadata";
const requiredMetadataKey = Symbol("required");

/*
The expression for the parameter decorator will be called as a function at runtime, with the following three arguments:

Either the constructor function of the class for a static member, or the prototype of the class for an instance member.
The name of the member.
The ordinal index of the parameter in the function’s parameter list.
*/

interface SocketFile {
    content:Buffer,
    name:string
};
export interface InsaneFilesInput {
    pdb:SocketFile,
    top:SocketFile,
    itps:SocketFile[]
}
const isSocketFile = (o:any): o is SocketFile => {
    if (typeof o !== 'object' || o == null)
        return false;
    if(!("file" in o))
        return false;
    if (Buffer.isBuffer(o.file))
        return false;
    if(!("fileName" in o))
        return false;
    if(typeof o.fileName !== 'string')
        return false;    
    return true;
}
export const isInsaneFilesInput = (obj:any): obj is InsaneFilesInput => {
    if (typeof obj !== 'object' || obj == null)
        return false;
    for (let ext of ["pdb", "top", "itps"]) 
        if(! (ext in obj))
            return false;
    if(!isSocketFile(obj.pdb))
        return false
    if(!isSocketFile(obj.top))
        return false
    if(!Array.isArray(obj.itps))
        return false
    for (let itp of obj.itps) 
        if(!isSocketFile(itp))
            return false;
    return true;
}
