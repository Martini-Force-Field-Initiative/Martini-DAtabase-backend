/*
Martini force field versioninn logics
Rules taken from :
https://github.com/marrink-lab/martini-forcefields
*/

import ForceFieldStore, {ForceFieldItem} from '../Stores/ForceFieldStore';

export const rawVersionGreaterThan = (me:string, other:string):boolean => {
    if (me === 'latest')
        return true 
    if (other === 'latest')
        return true 
    const a1 = me.split('.').map(field => parseInt(field) ? parseInt(field) : 0); 
    const a2 = other.split('.').map(field => parseInt(field) ? parseInt(field) : 0);
    
    if(a1.length >= a2.length)
        for (let i = 0 ; i < a1.length - a2.length ; i++)
            a2.push(0);
    else
        for (let i = 0 ; i < a2.length - a1.length ; i++)
             a1.push(0);

    for(let i = 0 ; i < a1.length ; i++) {      
        if (a1[i] > a2[i])
            return true;
        if (a2[i] > a1[i])
            return false;
    }
    return true;
}


class MartiniVersionError extends Error {}

export const popLatestForceField = (ffs:string[]):string => {
    const ffStore = ForceFieldStore.getStore();
    if(! ffs.length)
        throw new MartiniVersionError("[martiniVersions:popLatestForceField] Empty forcefield array");
       
    let best_ff:ForceFieldItem|undefined=undefined;
    for (const ff of ffs) {
        if(!ffStore.isAvailableForceField(ff))
            throw new MartiniVersionError("[martiniVersions:popLatestForceField] Irregular forcefield name " + ff);
        const _ = ffStore.getForceFieldItem(ff);
        if(best_ff == undefined) {
            best_ff = _;
            continue;
        }
        best_ff = _.weight > best_ff.weight ? _ : best_ff;
    }
    if(best_ff == undefined)
         throw new MartiniVersionError("[martiniVersions:popLatestForceField] Empty ff version");
    return best_ff.name;
}
/*
    matini version tag checkers
*/


const re_strict = /^martini_v([\d]+)\.([\d]+)\.{0,1}([\d]+){0,1}(_{0,1}[^\.]+){0,1}$/;
const re_weak = /^martini([\d])([\d])([\d]+){0,1}$/;


export class MartiniVersion {
    label:string
    major:number
    minor:number
    patch:number
    comment?:string   

    constructor(public input:string) {
        const stripFileExt = /\.itp$/;    
        this.label        = input.replace(stripFileExt, "");

        let buff = re_strict.exec( this.label );       
        if(buff) {
            this.major   = parseInt(buff[1]);
            this.minor   = parseInt(buff[2]);
            this.patch   = buff[3] ? parseInt(buff[3]) : 0
            this.comment = buff[4]; // maybe undefined
            return;    
        }
        buff = re_weak.exec(this.label);
        if(buff) {          
            this.major    = parseInt(buff[1]),
            this.minor    = parseInt(buff[2]),
            this.patch    = buff[3] ? parseInt(buff[3]) : 0;
            return;
        }
        throw new MartiniVersionError(`Not a valid force field name @"\${this.input}\"`);
    }
    get isBaseVersion():boolean {
        return this.comment === undefined;
    }
    /** 
     * Compare two MartinVersions return true if the caller has a higher version number
     * The optional trailing comment field is ignored
    */
    public gt(other:MartiniVersion):boolean {
        if (this.major > other.major)
            return true;        
        if (this.major < other.major)
            return false;        
        
        if (this.minor > other.minor)
            return true;
        
        if (this.minor < other.minor)
            return false;
        
        if (this.patch > other.patch)
            return true;
        
        if (this.patch < other.patch)      
            return false;
        
        // if comment is not present, we consider it base version and assign it more weigth
        if(!this.comment && other.comment) 
            return true;
        
        if(this.comment && !other.comment)
            return false;
        
        return (this.comment as string) > (other.comment as string);
    } 
    /** 
     * Compare two MartinVersions return true if they have identical version number
     * The optional trailing comment field is ignored
    */
    public eq(other:MartiniVersion):boolean {
        if (this.major !== other.major)
            return false;        
        if (this.minor !== other.minor)
            return false;
        if (this.patch !== other.patch)
            return false;
        
        if (this.comment && !other.comment)
            return false;
        if (!this.comment && other.comment)
            return false;       
        if (this.comment !== other.comment)
            return false
        return true;
    }
}

export function sortByLatestVersionNumber<T>(inputs:[version:string, datum:T][]):[string,T][] {
    /** Sort an array of 2-uple of [ martini forcefield versions (as string), any datum ]
    * Latest versions at the tail, older and then invalid ones at the head
    */
    const toSort:[MartiniVersion|string, T][] = inputs.map((t) =>{
        try{return [new MartiniVersion(t[0]), t[1]]; 
        } catch {return t;}
    });
    const sorted = toSort.toSorted( (t1,t2) => {
        //logger.debug(`${t1} vs ${t2}`);
        let a,b,_;
        [a, _] = t1;
        [b, _] = t2;
        // a, b as garbage-in
        if (typeof(a) === 'string' && typeof(b) === 'string')
            return 0;
        if (typeof(a) === 'string') 
            return -1;
        if (typeof(b) === 'string') 
            return 1;
        
        if(a.gt(b)) 
            return 1;

        if(a.eq(b)) 
            return 0;
        return -1;
    })

    return sorted.map( (t:[MartiniVersion|string,T]) =>{
        return [  
            typeof(t[0]) === 'string' ? t[0] : t[0].input, 
            t[1] ];
    });
}