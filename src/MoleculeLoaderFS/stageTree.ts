import {  VersionDatum, OMD } from './types';
import { MoleculeDatum } from './fileSystemParser';
import { rawVersionGreaterThan } from '../helpers/martiniVersions';
import ForceFieldStore from '../Stores/ForceFieldStore';
import {cliLogger} from '../logger';
import { inspect } from 'util';
import { basename } from 'path';
/*
class MyTree implements stageTree {
    constructor () {}
}
*/

/* StageTree API
    tree.forEachMolecule( (alias, moleculeData) = {

        moleculeData.forEachFF( ( moleculeDatum, versionDatum )=> {

        })
    })

*/

/* Keeping this as exemple of mandatory key from a subset of union literal
export type stageTree = { [K in AvailableForceFields]? : { [alias:string]: MoleculeDatum } };
*/
interface AliasConsumer {
    (moleculeDescriptor:OMD, versions:VersionDatum[]):Promise<void>
}

interface VersionGenerator {
    forEachForcefield: ( arg0:AliasConsumer ) => Promise<void>
};

interface VersionGeneratorSync{
    forEachForcefield: ( arg0:AliasConsumerSync ) => void
};
interface AliasConsumerSync {
    (moleculeDescriptor:OMD, versions:VersionDatum[]):void
}



class StageTreeCreationError extends Error{};

/* Organize the Queue of Version Molecule Datum into a hierarchical structure
* with top node as Alias 
* and one single intermediary node as FF
* Each leaf is a MoleculeDatum with a version array storing all its versions
* We expect leaves to be genuine new Molecule Datum and NOT references from the input batch queue.
* The stored VersionDatum remaining ref copy
*/

export class StageTree {
    private data : { [alias:string] : {[ff:string] : MoleculeDatum } } = {};
    private static CloneMoleculeDatumEmptyVersion(from:MoleculeDatum):MoleculeDatum {
        return  { versions : [], 
            name : from.name, 
            alias : from.alias,
            category: from.category
        };
    }
    constructor() {}
    public static createFromBatch(batch:MoleculeDatum[]) {
        const ffStore = ForceFieldStore.getStore();
        const stageTree = new StageTree();
        batch.forEach( (mDatum) => { // Foreach MoleculeDatum_SingleVersion batch element
            if( ! (mDatum.alias in stageTree.data)) // Allocate a slot based on alias
                stageTree.data[mDatum.alias] = {};
            if(mDatum.versions.length != 1 )
                throw new StageTreeCreationError(`[StageTree] Unexpected number of base version on input \"${mDatum.versions.length}\"`)
            const version =  mDatum.versions[0]
            if(!ffStore.isAvailableForceField(version.force_field) )
                throw new StageTreeCreationError("Unknown Force-field " + version.force_field );
            if ( !(version.force_field in stageTree.data[mDatum.alias]) ) 
                // Clone the first encoutered Molecule Datums and bind it as leaf to the FF node
                stageTree.data[mDatum.alias][version.force_field] = StageTree.CloneMoleculeDatumEmptyVersion(mDatum);    
            const molDatumLeaf = stageTree.data[mDatum.alias][version.force_field] as MoleculeDatum;
            // insert the single version object at the right position in the versions ordered array
            for (let iVersion = 0 ; iVersion < molDatumLeaf.versions.length ; iVersion++) {        
                if( rawVersionGreaterThan(molDatumLeaf.versions[iVersion].number, version.number) ) {
                    molDatumLeaf.versions.splice(iVersion, 0, version);
                    return;
                }
            }

            molDatumLeaf.versions.push(version)
        });
          // Check for multiple latest tags
        stageTree._assertNonMultipleLatest();
        return stageTree;
    }
    _assertNonMultipleLatest() {
        for (const [alias, ffSubTree] of Object.entries(this.data)) {
            for (const [forcefield, molDatumLeaf] of Object.entries(ffSubTree)) {
                const nbLatest = molDatumLeaf.versions.reduce(
                    (n, versionDatum) => versionDatum.number === 'latest' ? n + 1 : n
                    , 0);
                if (nbLatest > 1)
                    throw new StageTreeCreationError(`[StageTree] Unexpected multiple latest for ${alias} ${forcefield}`);
                
            }
        }
    }
    _forEachMolecule(callback:(forcefield:string, moleculeData:VersionGenerator)=>void ) {
       
        for (const [alias, ffSubTree] of Object.entries(this.data)) {
            const _:VersionGenerator = {
                forEachForcefield : async (callbackInner:AliasConsumer) => {
                    for (const [forcefield, moleculeDatum] of Object.entries(ffSubTree))
                        await callbackInner( { name: moleculeDatum.name, 
                                        alias: moleculeDatum.alias, 
                                        category: moleculeDatum.category,
                                        forcefield }, 
                                        moleculeDatum.versions
                                    )
                }
            };
            callback(alias, _);
        }
    }
    async forEachMolecule(callback:(forcefield:string, moleculeData:VersionGenerator)=>Promise<void> ) {
       
        for (const [alias, ffSubTree] of Object.entries(this.data)) {
            const _:VersionGenerator = {
                forEachForcefield : async (callbackInner:AliasConsumer) => {
                    for (const [forcefield, moleculeDatum] of Object.entries(ffSubTree))
                        await callbackInner( { name: moleculeDatum.name, 
                                        alias: moleculeDatum.alias, 
                                        category: moleculeDatum.category,
                                        forcefield:forcefield}, 
                                        moleculeDatum.versions
                                    );                        
                }
            };
            await callback(alias, _);
        }
    }
    async forEachMoleculeSync(callback:(forcefield:string, moleculeData:VersionGeneratorSync)=>void ) {
       
        for (const [alias, ffSubTree] of Object.entries(this.data)) {
            const _:VersionGeneratorSync = {
                forEachForcefield : (callbackInner:AliasConsumerSync) => {
                    for (const [forcefield, moleculeDatum] of Object.entries(ffSubTree))
                        callbackInner( { name: moleculeDatum.name, 
                                        alias: moleculeDatum.alias, 
                                        category: moleculeDatum.category,
                                        forcefield:forcefield}, 
                                        moleculeDatum.versions
                                    );                        
                }
            };
            callback(alias, _);
        }
    }
    get dim(){
        let versionCount = 0;
        let moleculeCount = Object.keys(this.data).length;
        const forceFields = new Set();
        for (let alias in this.data){
            for (let ff in this.data[alias] ) {
                forceFields.add(ff);
                //@ts-ignore
                versionCount += this.data[alias][ff].versions.length;
            }
        }
        return { versionCount, moleculeCount, forcefieldCount :forceFields.size}
    }
    report(start?:number, end?:number) {
        const report = [["Index", "Source", "Alias", "ForceField", "Version", "Inserted"]];
        let i = - 1;
        this.forEachMoleculeSync( (alias, molecules) => {
            molecules.forEachForcefield( ( molData, versions) => {               
                versions.forEach( (v) => {
                    i++;
                    if (start !== undefined && i < start)
                        return;
                    if (end !== undefined && i >= end)
                        return;
                    cliLogger.info(inspect(versions));
                    cliLogger.info(basename(v?.__bundle__.path));
                    report.push(
                    [`[${i}]`, basename(v?.__bundle__.path), molData.alias, molData.forcefield, v.number, v.inserted ? "YES":"NO"]);
                });
            });
        });
        return report;
    }
}