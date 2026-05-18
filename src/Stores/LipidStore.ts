

import logger from '../logger';
import { readFile } from 'node:fs/promises';
import DatabaseMoleculeDesk from '../helpers/database/molecule';
import { inspect } from 'util';

/*
Managing the library of lipids according to :
    - force field
    - tool

    1st objectve: speedup the assignation of supported lipid when running the MembraneBuilder w/ insane
    Optional feaeture: update ist list of supported lipids on CRON as it depends on MAD:Database ITP availablilites which may augment over time

*/
export default class LipidStore {

    static instance: LipidStore;
    static async setStore(insaneDef: [string, string][]): Promise<void> {
        const lpdStore = new LipidStore();
        await lpdStore.loadInsaneDef(insaneDef);
        LipidStore.instance = lpdStore;
    }
    public static getStore(): LipidStore {
        if (!LipidStore.instance) 
          throw new Error(`LipidStore:store not initialized`);   
        return LipidStore.instance;
    }
    insaneSupported: { [ff: string]: string[] } = {};
    insaneDefiles: { [ff: string]: string } = {};

    constructor() { }
    async loadInsaneDef(insaneDef: [string, string][]) {
        for (const [ff, fPath] of insaneDef) {
            try {
                logger.debug(`[LipidStore:loadInsaneDef] Reading ${ff} lipid definitions from ${fPath}`);
                const insane_def_data = JSON.parse(await readFile(fPath, 'utf8'));
                this.insaneDefiles[ff] = fPath;
                this.insaneSupported[ff] = [];
                for (const type in insane_def_data)
                    for (const lipidAlias in insane_def_data[type].a) {
                        const _ = await DatabaseMoleculeDesk.isForceFieldSupported(lipidAlias, ff);
                        if (_)
                            this.insaneSupported[ff].push(lipidAlias);
                        else
                            logger.warn(`[LipidStore:loadInsaneDef]Could not find lipid ${lipidAlias} in database for force field ${ff}`);
                    }
            } catch (err) {
                throw new Error(`[LipidStore:loadInsaneDef] Error reading INSANE ${ff} definition file ${err}`);
            }
        }
        logger.debug(`[LipidStore:loadInsaneDef] complete w/ following lipids ${inspect(this.insaneSupported)}`);
    }
    getSupportedLipidsAlias(ff: string) {
        if ( !(ff in this.insaneSupported) )
            throw new Error(`[LipidStore:getSupportedLipidsAlias] no such force field ${ff}`);
        return this.insaneSupported[ff];
    }
    getInsaneLipidDefinitionFile(ff: string) {
        if ( !(ff in this.insaneDefiles) )
            throw new Error(`[LipidStore:getInsaneLipidDefinitionFile] no such force field ${ff}`);
        return this.insaneDefiles[ff];
    }
    get anySupportedLipidsAlias():string[] {
        const _:Set<string> = new Set()
        for (const aliase in Object.values(this.insaneSupported)) 
            _.add(aliase);
        return [..._];
    }
}
