import logger from '../logger';
import Executor from '../Builders/Executor';
import MolTypeConverter from '../controllers/common/polyplyTmpMapper';
import { inspect } from 'node:util';
import { PolyplyTargetLib } from './Vermouth';
export default class PolyplyStore {

    static instance: PolyplyStore;
    static async setStore(envs: Record<string, string>): Promise<void> {
        const plpStore = new PolyplyStore(envs);
        await plpStore.loadBlocks();

        logger.debug(`[PolyplyStore:setStore] Available polyply environments:\n${inspect(plpStore.environments,{depth:4})}`);
        PolyplyStore.instance = plpStore;
    }
    public static getStore(): PolyplyStore {
        if (!PolyplyStore.instance) 
          throw new Error(`PolyplyStore:store not initialized`);   
        return PolyplyStore.instance;
    }

    ff:PolyplyTargetLib[] = ["martini2", "martini3"];
    version:string = "0.01";
    blocksData: Record< string, Record<string, [string, string, string][]> > = {};
    environments: Record<PolyplyTargetLib, string[]> = {};
    /**
     * Creates a new PolyplyStore instance, given a record of environment.
     * Each key of the record must be a valid polyply library name.
     * @param envs - Record of environment to use.
     * @throws Error if an unknown polyply library is found in the record keys.
     */
    constructor(envs: Record<string, PolyplyTargetLib>) {
        for (const [symbol, target] of Object.entries(envs)) {
            if (!(target in this.environments)) 
                this.environments[target] = []; // initialize an empty array for the environment
            this.environments[target].push(symbol);
        }       
    }
    async loadBlocks() {
        logger.debug("PolyplyStore: Fectching available building blocks list and polyply version");       
        const { stdout, jobFS } = await Executor.run("get_polyply_settings", 
            { 
                exportVar: { forcefields: this.ff.toString() }, inputs: {}
            });    

        let tempff = '';
        const polyplyDataBuffer:{[key:string] : string[]} = {};     
        stdout.split("\n").forEach((line:string) => {
            if(line === "")
                return;
            if (line.startsWith("POLYPLY_VERSION")) {
                this.version = line.split(" ")[1];
                return;
            } 
            // store  and call createCAalogue 
            if (line.startsWith("FORCEFIELD :")) {
                tempff = line.replace("FORCEFIELD :", "")
                polyplyDataBuffer[tempff] = [];
                logger.debug(`[PolyplyStore:loadBlocks] ${tempff} forcefield slot created`);
            }
            else  {
                logger.debug(`[PolyplyStore:loadBlocks] adding ${line} to ${tempff} forcefield slot`);
                polyplyDataBuffer[tempff].push(line);
            }
            /* 
                Trying to put this out of loop
                for (let forceField in polyplyDataBuffer) {
                    polyplyData[forceField] = MolTypeConverter.createCatalogue(polyplyDataBuffer[forceField]);
                }
            */
        });
        for (let forceField in polyplyDataBuffer)
            this.blocksData[forceField] = MolTypeConverter.createCatalogue(polyplyDataBuffer[forceField]);
        
        logger.debug(`[PolyplyStore:loadBlocks] v${this.version} block data:\n${inspect(this.blocksData, {depth:4})}`);
    }

    get polyplyData(){
       //Select only martini forcefield
       const martiniOnly = Object.keys(this.blocksData).filter( (k)=>k.includes("martini")).reduce( 
            (o,k)=> { return { ...o, [k]:this.blocksData[k] };
        }, {});
        logger.debug(`[PolyplyStore:PolyplyStore] providing forcefields and residues data:\n${inspect(martiniOnly, {depth:4})}`);
        return martiniOnly;
    }

}
