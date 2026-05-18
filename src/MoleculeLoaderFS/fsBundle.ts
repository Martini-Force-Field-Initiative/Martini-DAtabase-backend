import TmpDirHelper from "../TmpDirHelper"
import { promises as FsPromise, createWriteStream } from 'fs';
import { InputTextWrapper } from "../helpers/inputs";
import { Readable } from "stream";
import logger from '../logger';
import { basename } from "path";
import { statSync } from "fs";
import { MulterLikeFile } from '../types'
import { ItpModOptions, ItpTransformer } from '../helpers/itp/meta_comments';
import { promises as streamPromise } from  'stream';
import { isConnectPdb } from '../helpers/gmxUtils';
import JSZip from 'jszip';
import { readableToFile } from "../helpers/inputs";
/**
Encapsulate single molecule/bundle FS logics
It takes a path to a molecule folder
and copy into a tmp and expose getters/setters to FS filess
*/

class MoleculeBundleFileError extends Error {}


interface MoleculeBundleJSON {
    directory:string;
    pdb:MulterLikeFile;
    itp:MulterLikeFile;
    gro:MulterLikeFile;
    map:MulterLikeFile[];
    others:MulterLikeFile[];
    top:MulterLikeFile;
}
// For now only itp modifications
interface BundleAttributeMod extends ItpModOptions {

}

export class MoleculeBundle {
    id:string;
    private tmpLoc:string='';
    //  factory
    static async create(path:string):Promise<MoleculeBundle> {
        const m = new MoleculeBundle(path);
        await m.build();
        logger.debug(`[MoleculeBundle] created: ${m.asString()}`)
        return m;
    }
    // self mutating to reset
    public async reset(){
        const files2remove = (await FsPromise.readdir(this.tmpLoc)).map(f => `${this.tmpLoc}/${f}`);
        const _ = await Promise.allSettled( files2remove.map( (f) => FsPromise.unlink(f) ));
        await this.build();
    }
    private async build() {
        const files = this.path.endsWith('.zip') ?
                      await this.unpack() :
                      await this.copy();       
        this.id = this.tmpLoc.split('/').pop() ?? ''; 
        
        await this.register(files);
    }
    constructor (public path:string){
        this.id=basename(''); // Extract snowflke ID
    }
    
    _itp:string[]   = []
    _gro:string[]    = []
    _maps:string[]   = []
    _top:string[]    = []
    _pdb:string[]    = []
    _cmaps:string[]  = []
    _others:string[] = []

    // Copying file from provided archive
    private async unpack():Promise<string[]> {
        if (this.tmpLoc === '')
            this.tmpLoc = await TmpDirHelper.get();

        logger.debug(`[fsBundle:unpack] ${this.path} Starting`);
        const zippedData = await FsPromise.readFile(this.path);            
        return new Promise ( (res, rej) => 
            JSZip.loadAsync(zippedData).then((zip) => {
                let ttl=0;
                zip.forEach( ()=>ttl++ );
                const files:string[] = [];
                zip.forEach( async (relPath, file) => {
                    const b = await file.async('nodebuffer')
                    await FsPromise.writeFile(`${this.tmpLoc}/${relPath}`, b);
                    logger.info(`unziped into ==>${this.tmpLoc}/${relPath}`);
                    files.push(`${this.tmpLoc}/${relPath}`);
                
                    if(files.length == ttl) {
                        logger.debug(`[fsBundle:unpack] ${this.path} Done!`);
                        res(files);
                    }
                });
            })
        );           
    }
    // copying file from provided directory
    private async copy():Promise<string[]> {
        const files = (await FsPromise.readdir(this.path)).map(f => `${this.path}/${f}`);
        
        if(this.tmpLoc === '')
            this.tmpLoc = await TmpDirHelper.get(files);
        else // Copy from src into preexisting this.tmpLoc
            await Promise.allSettled( files.map( (f) => FsPromise.copyFile(f, `${this.tmpLoc}/${basename(f)}`) ));   
        return files; 
    }
    // input files registration
    private async register(files:string[]) {
        for (const f of files.map(f=>basename(f))) {           
            if(f.endsWith('.itp'))
                this._itp.push(f);
            else if(f.endsWith('.gro'))
                this._gro.push(f);
            else if(f.endsWith('.map'))
                this._cmaps.push(f);
            else if (f.endsWith('.top'))
                this._top.push(f);
            else if(f.endsWith('.pdb'))
                if ( await isConnectPdb(`${this.tmpLoc}/${f}`) )
                    this._pdb.push(f);
                else
                    logger.warn(`[MoleculeBundle] ${this.id} Non-connected PDB file @${f}, skipping it`);
            else
                this._others.push(f);
        }       
    }
    public zip(zipFilePath:string) {
            // Still performed inside MoleculOrganizer:zipFromPaths
    }
    get workDir() {
        return this.tmpLoc;
    }
    /** 
     * Alter data fields inside bundle files
     * currently only ITP fields are supported
    */
    async alter(opt:BundleAttributeMod) {
        const { category, forcefield, name, number, alias, resetCategory } = opt;
        
        // operate on ITP        
        if (category || forcefield || name || number || alias) {            
            await streamPromise.pipeline(
            this.itp,
            await ItpTransformer.create({ category, forcefield, name, number, alias, resetCategory }, {}),
            createWriteStream(`${this.tmpLoc}/.itp_swap`)
            );
            await FsPromise.copyFile(`${this.tmpLoc}/.itp_swap`, this.itpFilePath);                   
        } 
        // other file content mods ...
        logger.debug(`==> Have altered this one: ${this.tmpLoc}/.itp_swap into ${this.itpFilePath}`);
    }
    /**
     * 
     * Rename all bundle files, keeping extensions intact based on provided string
     */
    rename(filename:string) {

    }
    validate(){}
    asString() {
        let s = `<MoleculeBundle\n\t@from:${this.path}`;
        s+= `\n\t@tmp:${this.tmpLoc}`;
        if(this._pdb.length)
            s+=`\n\t- ${this._pdb.join(',')}`
        if(this._gro.length)
            s+=`\n\t- ${this._gro.join(',')}`
        if(this._top.length)
            s+=`\n\t- ${this._top.join(',')}`
        if(this._itp.length)
            s+=`\n\t- ${this._itp.join(',')}`
        if(this._cmaps.length)
            s+=`\n\t- ${this._cmaps.join(',')}`
        if(this._others.length)
            s+=`\n\t- ${this._others.join(',')}`
        return `${s}\t/>`;
    }

    get noPDB():boolean {
        return this._pdb.length === 0;
    }
    get noGRO():boolean {
        return this._gro.length === 0;
    }
    /**
     * Attach a GRO or PDB file record
     * Warnings: - Any previous will be erased
     *           - This modification will be lost if the bundle is reset 
     * @param src A coordinate Readable 
     */
    async setPDB(src:Readable) {
        this._pdb = [`${this.id}.pdb`];
        await readableToFile(src,`${this.tmpLoc}/${this._pdb[0]}`);
    }
    async setGRO(src:Readable) {
        this._gro = [`${this.id}.gro`];
        await readableToFile(src,`${this.tmpLoc}/${this._gro[0]}`);
    }

    /** File as streams accessors */
    get pdb():Readable {
        if(!this._pdb.length)
            throw new MoleculeBundleFileError(`No pdb found @${this.path}`);
        return InputTextWrapper(`${this.tmpLoc}/${this._pdb[0]}`)
    }
    get gro():Readable {
        if(!this._gro.length)
            throw new MoleculeBundleFileError(`No gro found @${this.path}`);
        return InputTextWrapper(`${this.tmpLoc}/${this._gro[0]}`)
    }
    get top():Readable {
        if(!this._top.length)
            throw new MoleculeBundleFileError(`No top found @${this.path}`);
        return InputTextWrapper(`${this.tmpLoc}/${this._top[0]}`)
    }  
    get itp():Readable {
        if(!this._itp.length)
            throw new MoleculeBundleFileError(`No itp found @${this.path}`);
        return InputTextWrapper(`${this.tmpLoc}/${this._itp[0]}`)
    }
        /** Get original file path */
    get pdbFilePath():string {
        if(!this._pdb.length)
            throw new MoleculeBundleFileError(`No pdb found @${this.path}`);
        return `${this.tmpLoc}/${this._pdb[0]}`;
    }
    get groFilePath():string {
        if(!this._gro.length)
            throw new MoleculeBundleFileError(`No gro found @${this.path}`);
        return `${this.tmpLoc}/${this._gro[0]}`;
    }
    get topFilePath():string {
        if(!this._top.length)
            throw new MoleculeBundleFileError(`No top found @${this.path}`);
        return `${this.tmpLoc}/${this._top[0]}`;
    }
    get itpFilePath():string {
        if(!this._itp.length)
            throw new MoleculeBundleFileError(`No itp found @${this.path}`);
        return `${this.tmpLoc}/${this._itp[0]}`;
    }
    get itpFilesPath():string[] {
        if(!this._itp.length)
            throw new MoleculeBundleFileError(`No itp found @${this.path}`);
        return this._itp.map( itp => `${this.tmpLoc}/${itp}`)        
    }    
    get mapFilesPath():string[]{
        if(!this._cmaps.length)
            return [];
            //throw new MoleculeBundleFileError(`No map found @${this.path}`);
        return this._cmaps.map(f => `${this.tmpLoc}/${f}`);
    }
    get othersFilesPath():string[]{
        if(!this._others.length)
            return [];
            //throw new MoleculeBundleFileError(`No map found @${this.path}`);
        return this._others.map(f => `${this.tmpLoc}/${f}`);
    }
    async ItpComments ():Promise<string> {
        
        return new Promise ( (res, rej) => {
            let cmt = '';
            const s = this.itp;
            s.on('end', () => res(cmt) );             
            let read = true;
            s.on('data', (chunk:any) => {            
                const _ = chunk.toString().split('\n');
                for (let l of _ ) {                    
                    if(l.startsWith("["))
                        read=false;
                    if(read)
                        if(l.startsWith(';'))
                            cmt += l + "\n";                            
                }               
            });
        });
    }
    get force_field() {
        // Not guaranted to be found i ncomment itp yet
        return undefined;
    }
    asJSON():MoleculeBundleJSON {
        const json:Partial<MoleculeBundleJSON> = {directory:this.tmpLoc};
        if(this._pdb.length)
            json.pdb = { originalname: basename(this.pdbFilePath), 
                        size       : statSync(this.pdbFilePath).size,
                        path       :this.pdbFilePath
            };
        if(this._gro.length) 
           json.gro = { originalname: basename(this.groFilePath), 
                size       : statSync(this.groFilePath).size,
                path       :this.groFilePath
            };
        if(this._top.length)
            json.top = { originalname: basename(this.topFilePath), 
                size       : statSync(this.topFilePath).size,
                path       : this.topFilePath
            };
        if(this._itp.length)
            json.itp = { originalname: basename(this.itpFilePath), 
                        size       : statSync(this.itpFilePath).size,
                        path       :this.itpFilePath
            };
        if(this._cmaps.length)
            json.map = this.mapFilesPath.map( (mf) => {
                return { originalname : basename(mf), 
                        size         : statSync(mf).size,
                        path         : mf
            }});
        if(this._others.length)
            json.others = this.othersFilesPath.map( (mf) => {
                return { originalname : basename(mf), 
                        size         : statSync(mf).size,
                        path         : mf
            }});


        return json as MoleculeBundleJSON;
    }
    // Currenlty no need to handle mutlple itp case, may change in the future
    /*get itps():Generator<Readable> {
        function *gen(itps:string[]) {
            for (let itp of itps)
                yield InputTextWrapper(itp as string)
        }
        if(!this._itps.length)
            throw new MoleculeBundleFileError(`No pdb found @${this.path}`);
        return gen(this._itps);
    }*/

    get nb_pdb():number {
        return this._pdb.length;
    }
    get nb_gro():number {
        return this._gro.length;
    }
    get nb_top():number {
      return this._top.length;
    }
    get nb_itp():number {
        return this._itp.length;
    }
}

