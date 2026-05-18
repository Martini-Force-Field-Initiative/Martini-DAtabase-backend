import {readdirSync, lstatSync} from 'fs';

export const getDirInside = (path : string) => {
    return readdirSync(path).filter((dir: string) => lstatSync(`${path}/${dir}`).isDirectory())
}

/**
 * yield all the innermost folders (aka folder with no subfolder) under provided "path"
 * @param path 
 * @returns Generator of relative paths 
 */
export function* dirRecursive (path: string) : Generator<string> {
    const subdir = getDirInside(path)
    if(subdir.length === 0){
        yield path
    }
    for (const dir of subdir){
        yield* dirRecursive(`${path}/${dir}`)
    }
}