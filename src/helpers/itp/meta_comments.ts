import ItpFile from "itp_mad_parser";
import { GoTerm } from '../../types/index';
import { readableToString } from "../inputs";
import logger from '../../logger';
import { Readable, Transform, TransformOptions } from "stream";
import { promises as FsPromise } from 'fs';
import ForceFieldStore, { AvailableForceField } from "../../Stores/ForceFieldStore";
import SettingsWrapper from "../settingsManager";
import { inspect } from "util";
/** 
 * Modify the specified comment fields on ITP content stream input
 * category
* fullflush did not work
* Settings.sjon what do we do ? it can mutate from controller:settings ....
*/

class ItpTransformerError extends Error {};

export class ItpTransformer extends Transform {
    private data = '';
    private newCategory?:GoTerm[];
    private newNumber?:string;
    private newForcefield?:AvailableForceField;
    private newName?:string;
    private newAlias?:string;
    private resetCategory:boolean = false;
    private flushed:{ [field:string]: boolean } = {};
    private _flushed = false;
    public static async create(iptOpt:ItpModOptions, options:TransformOptions){
        const ITPTF   = new ItpTransformer(options);
        const ffStore = ForceFieldStore.getStore();
        const settings = await SettingsWrapper.getSettingsWrapper();
        const { category, number, forcefield, name, alias, resetCategory = false } = iptOpt;
  
        if (forcefield)
            if (!ffStore.isAvailableForceField(forcefield))
                throw new Error(`${forcefield} is not a valid forcefield`);
            
        if( category )
            ITPTF.newCategory  = category.map( (c) => { 
                if ( !settings.findInCategoryTree(c) )
                    throw new ItpTransformerError(`Unknown category symbol \"${c}\"`);
                return settings.category_tree[c].name;
            });
        
            //category.forEach((c) => { if (!isGoTerm(c)) throw new Error(`${c} is not a valid category`); });
            
        //this.newCategory = category;
        ITPTF.newName = name;
        ITPTF.newAlias = alias;
        ITPTF.newForcefield = forcefield;
        ITPTF.newNumber = number;
        ITPTF.resetCategory = resetCategory;      
        ITPTF.flushed = {
            category   : false,
            name       : false,
            number     : false,
            forcefield : false,
            alias      : false
        };
        return ITPTF;
    }
    constructor(options:TransformOptions) {
        super(options);
    }

    _transform(chunk:any, _:any, callback:any){
        this.data += chunk.toString("utf8");
        callback();
    }
    _flush(callback:any){
        const stream = this;
        let cFld:string|undefined = undefined;
        this.data.split('\n').forEach( (line) => {     
           // console.log("LINE:[" + cFld + "]" + line);
            if(/^;{0,1}[\s]*$/.test(line)) {
                cFld = undefined;
                stream.push(`${line}\n`);return;
            }

            if(/^;[\s]*Category[\s]*$/.test(line)) {
                cFld = 'category'
                stream.push(`${line}\n`);return;
            }
            // Reconciliating new categories with previous ones
            if(cFld === 'category') {
                if(this.flushed.category )
                    return;
                this.flushed.category = true;

                stream.newCategory?.forEach( (c) => stream.push(`;\t${c}\n`) );
                if(!stream.newCategory)
                    stream.push(`${line}`);
                else {
                    if(stream.resetCategory )
                        return;
                    const m = line.match(/^;[\s]*([\S].*[\S])[\s]*$/);
                    if(m) {
                        const curr_cat = m[1].toLowerCase();
                        if( stream.newCategory.map(c=>c.toLocaleLowerCase()).includes( curr_cat )  )
                            return;                                                    
                        stream.push(`${line}`);                                            
                    }
                }
                return;                    
            }

            if(/^;[\s]+Name[\s]*$/.test(line)) {               
                cFld = 'name'
                stream.push(`${line}\n`);return;
            }
            if(cFld === 'name') {
                if (stream.newName)
                    stream.push(`;\t${stream.newName}\n`);
                else 
                    stream.push(`${line}\n`);
                this.flushed.name = true;
                return;                
            }

            if(/^;[\s]+Alias[\s]*$/.test(line)) {               
                cFld = 'alias'
                stream.push(`${line}\n`);return;
            }
            if(cFld === 'alias') {
                if (stream.newAlias)
                    stream.push(`;\t${stream.newAlias}\n`);
                else 
                    stream.push(`${line}\n`);
                this.flushed.alias = true;
                return;                
            }
            
            if(/^;[\s]+Force field[\s]*$/.test(line)) {              
                cFld = 'ff'
                stream.push(`${line}\n`);return;
            }
            if(cFld === 'ff') {
                if(stream.newForcefield)
                    stream.push(`;\t${stream.newForcefield}\n`);
                else
                    stream.push(`${line}\n`);                
                this.flushed.forcefield = true;
                return;
            }

            if(/^;[\s]+Version[\s]*$/.test(line)) {                
                cFld = 'number'
                stream.push(`${line}\n`);return;
            }
            if(cFld === 'number') {
                if(stream.newNumber)                  
                    stream.push(`;\t${stream.newNumber}\n`);                
                else
                    stream.push(`${line}\n`);
                this.flushed.number = true;
                return;
            }
            if(/^\[/.test(line)) {                
                if(!this._flushed)
                    stream.push( this.flushAll() );
            }           
            stream.push(`${line}\n`);
        });
        callback(null);
    }
    flushAll():string {
        let res = ''
        if(this.newCategory && !this.flushed.category)
            res += "; Category\n;\t" + this.newCategory.join("\n;\t") + "\n\n"
        if (this.newName && !this.flushed.name)
            res += `; Name\n;\t${this.newName}\n\n`; 
        if (this.newAlias && !this.flushed.alias)
            res += `; Alias\n;\t${this.newAlias}\n\n`; 
        if (this.newForcefield && !this.flushed.forcefield)
            res += `; Force field\n;\t${this.newForcefield}\n\n`;
        if (this.newNumber && !this.flushed.number)
            res += `; Version\n;\t${this.newNumber}\n\n`;        
        
        this._flushed = true;
        return res;
    }
}

export interface ItpModOptions {
  category?:GoTerm[],
  number?:string,
  forcefield?:AvailableForceField,
  name?:string,
  resetCategory?:boolean,
  alias?:string
}

export interface ItpCommentFields {
    name: string; 
    alias : string;
    category: string[]; 
    forceField : string; 
    version : string; 
    references? : string; 
    cmdLine?: string; 
    comments? : string;
}

export class ItpCommentFieldError extends Error {
    constructor(message: string) {
      super(message); // call the parent constructor
      this.name = "ItpCommentFieldError"; // set the name property
    }
  }


/* BAD CODING-STYLE SECTION LEGACY */

export const parseItpComments = async (file : string|Readable) => {
    
    const mandatoryHeadlineFields: { [itpField:string]: string } = {
        name : "; Name", 
        alias : "; Alias", 
        category : '; Category', 
        forceField : '; Force field', 
        version : '; Version'
    };
    const optionalHeadlineFields:{ [itpField:string]: string } = {
        references : "; Reference(s):", 
        cmdLine: "; Command line", 
        customTags: "; Custom tags",
        comments: "0"
    };

        
    const itp = ItpFile.readFromString(typeof file === "string" 
        ? await FsPromise.readFile(file, 'utf-8')
        : await readableToString(file) );

    const headlines = itp.headlines

    const symbolToParse = [...Object.values(mandatoryHeadlineFields), ...Object.values(optionalHeadlineFields)]

    const parsedHeadlines = parseHeadlines(headlines, symbolToParse)

    const buffer:Partial<ItpCommentFields> = {};

    for (const field in optionalHeadlineFields){
        const term = optionalHeadlineFields[field as keyof ItpCommentFields];
        if(!term)
            throw new ItpCommentFieldError(`Optional field \"${field}\" is declared but no value found @[${file}]`);
        //@ts-ignore
            buffer[field as keyof ItpCommentFields] = term in parsedHeadlines ?
                flatItpField(parsedHeadlines[term]) : ''
    }

    for(const field in mandatoryHeadlineFields) {       
        const term = mandatoryHeadlineFields[field as keyof ItpCommentFields]
        //@ts-ignore
        if (!(term in parsedHeadlines)){
            throw new ItpCommentFieldError(`No ${field} field in itp`);
        }
        //@ts-ignore
        buffer[field as keyof ItpCommentFields] = flatItpField(parsedHeadlines[term as keyof ItpCommentFields], !(field === "category"))
    }

    return buffer as ItpCommentFields;
}

const parseHeadlines = (headlines : string[], keys: string[]) => {
    let parsed : {[key: string]: string[]} = {'0':[]}
    let currentParsed = '0'
    for(const line of headlines){
        let delThisEmptyLine = false; 
        if(line === ";" && currentParsed !== '0'){
            delThisEmptyLine = true
            currentParsed = '0'
        }
        if(keys.includes(line)){
            currentParsed = line
            
            if(line in parsed){
                logger.error(`${line} already parsed, should not happen`)
                continue
            }
            parsed[currentParsed] = []
           
        } else {
            if(!delThisEmptyLine) parsed[currentParsed].push(line)
        }
        
    }   
    return parsed
}

const flatItpField = (field: string[], join=true) => {
    const flatArray = []
    for (const line of field){
        const trimmedLine = line[0] === ";" ? line.substring(1).trim() : line.trim()
        flatArray.push(trimmedLine)
    }
    if(!join) {        
        return flatArray.join().split(",");
    }
    return flatArray.join('\n')
}
