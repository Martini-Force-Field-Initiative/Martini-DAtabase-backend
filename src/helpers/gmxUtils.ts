import { PassThrough, Readable } from 'stream';
import { promises as fsp, createReadStream } from 'fs';
import { InputTextWrapper, isReadableStream, /* chunkSubstr,*/ stringToStream } from './inputs';

export type CoordinateFormat = "gro" | "pdb";

export class CoorInputError extends Error {
    constructor(message:string) {
      super(message); // (1)
      this.name = "CoorInputError"; // (2)
    }
}

const GRO_RE_COOR = /^([\s|0-9]{5})([\w\s]{5})([\w\s]{5})([\s|0-9]{5})([-\d\.\s]{8})([-\d\.\s]{8})([-\d\.\s]{8})([-\d\.\s]{8})([-\d\.\s]{8})([-\d\.\s]{8})$/;
const GRO_RE_COOR_NO_VELOCITY = /^([\s|0-9]{5})([\w\s]{5})([\w\s]{5})([\s|0-9]{5})([-\d\.\s]{8})([-\d\.\s]{8})([-\d\.\s]{8})$/;
const GRO_RE_BOX = /([-\d\.]+)/g;

const PDB_RE_COOR_WEAK = /^ATOM|HETATM/


/* https://manual.gromacs.org/archive/5.0.3/online/gro.html
"%5d%-5s%5s%5d%8.3f%8.3f%8.3f%8.4f%8.4f%8.4f"
*/

 /**
 * Takes a path or a stream to a coordinate text
 * Guess the format 
 * NB: pure stream implementation
 * @param pdb_or_gro
 * @returns the format and a ReadableStream to the begining of the ressource 
 */
export const anyCoorAsTypeAndStream = async (pdb_or_gro: string | Readable): Promise<[CoordinateFormat, Readable]> => {
    return new Promise(async (res, rej) => {
        let src: Readable | undefined = undefined;
        if (typeof pdb_or_gro === 'string') {
            try {
                const st = await fsp.stat(pdb_or_gro);
                if (st.isFile())
                    src = createReadStream(pdb_or_gro);
                else {
                rej(new CoorInputError(`${pdb_or_gro} is not a valid path to a non file element`));
                return;
                }
            } catch(e) {
                rej(new CoorInputError(`${pdb_or_gro} is not a valid path to any element`));
                return;
            }
        } else {
            if (!isReadableStream(pdb_or_gro)) {
                rej(new CoorInputError(`${pdb_or_gro} is not a path to file nor a stream`));
                return;
            }
            src = pdb_or_gro;
        }
        let fmt: CoordinateFormat | undefined;
        let acc = '';
        src.setEncoding('utf8');
        src.on('data', (chunk) => {            
            acc += chunk;
            const buffer = chunk.split("\n");
            buffer.forEach((line: string) => {
                if (!line.match(GRO_RE_COOR) && !line.match(PDB_RE_COOR_WEAK) && !line.match(GRO_RE_COOR_NO_VELOCITY))
                    return;
                if (line.match(GRO_RE_COOR) || line.match(GRO_RE_COOR_NO_VELOCITY)) {
                    if (fmt)
                        if (fmt === "pdb") {
                            rej(new CoorInputError(`Conflicting format coordinates from: ${chunk}`));
                            return;
                        }
                    fmt = "gro";
                } else if (line.match(PDB_RE_COOR_WEAK)) {
                    if (fmt)
                        if (fmt === "gro") {
                            rej(new CoorInputError(`Conflicting format coordinates from: ${chunk}`));
                            return;
                        }
                    fmt = "pdb";
                }               
            });
        });
        src.on('end', () => {
            if (!fmt) {
                rej(new CoorInputError(`Could not guess coordinates format (gro/pdb) from:\n${acc}`));
                return;
            }
           // res([fmt, Readable.from([acc])]);
           //res( [ fmt, Readable.from(chunkSubstr(acc, 1000)) ]);
           res([ fmt, stringToStream(acc) ] )
        });
    });
}

/** 
* Returns true if provided input PDB :
* - features lines beginning with CONNECT statement
* - is not a single atom coordinate file
*/
export const isConnectPdb = async(input:string|Readable):Promise<boolean> => {
    
    return new Promise( (res,rej)=> {
        let isCONNECT=false;
        let countRECORD = 0;
        const d = InputTextWrapper(input);
        d.on('data', (c)=> {
            const txt = c.toString();
            const lines = txt.split("\n");
            lines.forEach( (l:string)=> { 
                console.log(l);
                if(l.startsWith('CONECT')) isCONNECT=true;
                else if( l.startsWith('ATOM') )
                    countRECORD++;
            })
        }).on('close', ()=> res(isCONNECT || countRECORD == 1) );
    });
}

/**
 * Returns true if job work folder contains error due to harmless atom name missmatches 
 * @param fileList gromacs utility tools log files to look into
 */
export const grepOnlyNonMatchingNameWarn = async(src:Readable):Promise<boolean>  => {
    return new Promise ( (res, rej)=> {
        let warnCount = 0;
        let warnType = "";
        src.on('data', (chunk:any) => {
            const s = chunk.toString();
            let _ = /WARNING ([\d/]+)/.exec(s);
            if(_)
                warnCount = parseInt(_[1]);
            _ = /([\d]+) non-matching atom names/.exec(s);
            if(_)
                warnType = 'non-matching atom names';
        });
        src.on('close', () => res ( warnCount == 1 && warnType === 'non-matching atom names') );
    })
} 