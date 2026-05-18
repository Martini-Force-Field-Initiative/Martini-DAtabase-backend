import { Readable, PassThrough } from 'stream';
import StreamZip from 'node-stream-zip';
import { createReadStream, createWriteStream, unlink } from "fs";
import fs, { promises as FsPromise, existsSync } from 'fs';
import {basename}  from 'path';


/* Intendeed to represent a Valid source (to copy to FS) which can be  
a valid file or a stream w/ a target basename*/
export type FilePathOrTupleStream = string | [Readable, string];

/*export class FilePathOrTupleStream {
  constructor(src:string, )
}*/

export function isFilePathOrTupleStream(o:unknown) {
    if (typeof(o) === "string") 
        return isFilePath(o);
    if (!Array.isArray(o)) 
        return false;
    if(o.length != 2)
        return false;
    if(!isReadableStream(o[0]))
        return false;
    if(typeof(o[1] !== "string"))
        return false;

    return basename(o[1]) === o[1];
}
export function pathOfFilePathOrTupleStream(o:FilePathOrTupleStream):string {
  if (typeof(o) === "string")
    return o;
  return o[1];
}
export function srcOfFilePathOrTupleStream(o:FilePathOrTupleStream):string|Readable {
  if (typeof(o) === "string")
    return o;
  return o[0];
}

export type InputText = string|Readable|Buffer;
/**
 * Wrap incoming input into a Readable stream
 * @param input - A path to a file or a plain text string or a readable
 * @returns Readable - A readable stream of the input
 */

export const InputTextWrapper = (input:InputText, strict=true):Readable =>{
    if( isReadableStream(input) )
      return input;
    if(isBuffer(input))
      return Readable.from(input);
  
    if( existsSync(input) ) 
      return createReadStream(input);
    
    if(strict)
      throw(`Could not create ReadStream from maybe path \"${input}\", maybe pass it as plain text by setting strict to false`);
    //logger.debug(`Could not create ReadStream from maybe path \"${input}\", passing it as plain text`);
    
    return Readable.from([input])
  }
  


  export function isFilePath (obj:any): boolean {
    if (typeof obj !== 'string')
        return false;

    return existsSync(obj);
  }

  export function isReadableStream(obj:any): obj is Readable {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      typeof obj.pipe === 'function' &&
      typeof obj.on === 'function' &&
      typeof obj.read === 'function'
    );
  }
  

  export function isBuffer(obj:any): obj is Buffer {
    return Buffer.isBuffer(obj);
  }
  
  export const stringToStream = (str: string):Readable => {
    return Readable.from(str);
  }
  
  export const fileStringContent = (path:string):Promise<string> => {
    return new Promise ( (res,rej) => {
      const st = createReadStream(path);
      st.setEncoding('utf8');
      let content = '';
      st.on('data', (c) => content += c);
      st.on('close', ()=> { res(content)} );
    });
  }
  
  export const readableToString = async (src:Readable, codec:BufferEncoding='utf8'):Promise<string> => {
    src.setEncoding(codec);
    return new Promise ( (res, rej)=> {
      let stringOut = "";
      src.on('data', (chunk:string) => stringOut += chunk ); 
      src.on('end',  ()             => res(stringOut));
    });
  }
  
  export const readableToStringMany = (streams: NodeJS.ReadableStream[]): Promise<string>[] => {
    return streams.map(stream => new Promise((resolve, reject) => {
      let readedStream = "";
      stream.on('data', (chunk: string) => {
        readedStream += chunk
      })
      stream.on('end', () => resolve(readedStream))
      stream.on('error', reject)
    }))
  }
  
  
  export const readableToFile = async (src:Readable, tgt_path:string):Promise<void> => {
    //console.warn(`==>${tgt_path}`);
    const tgt = createWriteStream(tgt_path);
    src.pipe(tgt);
    return new Promise ( (res, _)=> tgt.on('close', res) );
  }
  
  export async function unzipReadable(name: string, zip: StreamZip) {
    return new Promise((resolve, reject) => {
      zip.stream(name, (err: any, stm: any) => {
        if (err)
          reject(err);
        resolve(stm);
      });
    }) as Promise<NodeJS.ReadableStream>
  }
  