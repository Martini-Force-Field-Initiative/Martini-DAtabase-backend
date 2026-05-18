
/*
  Current file organization is to be thought abt
  This host the common controller logics of insane
*/
import MembraneBuilder, { LipidMap, InsaneSettings, InsaneError } from '../../Builders/MembraneBuilder';
export {InsaneError} from '../../Builders/MembraneBuilder';
import Errors, { ErrorType } from '../../Errors';
import TmpDirHelper from '../../TmpDirHelper';
import { getFormattedFile } from '../../helpers/simple';
import { readableToFile, InputTextWrapper } from '../../helpers/inputs';
import { ClientInsaneSettingsDto } from '../dto/membraneBuilder.dto';
import logger from '../../logger';
//import { AvailableForceFields } from '../../helpers/martiniVersions';
import { Readable } from 'stream';
import { promises as fsp } from 'fs';
import {inspect} from 'util';
import { AvailableForceField } from '../../Stores/ForceFieldStore';


/*
Errors to catch in socket manager and forward mimicking HTTP style
Move them elsewhere also
*/
export class InsaneReadDefinitionError extends Error{};
export class InsaneMissingParameterError extends Error{};
export class InsaneMissingLipidParameterError extends InsaneMissingParameterError{};
export class InsaneMissingForceFieldParameterError extends InsaneMissingParameterError{};
export class InsaneMissingFilesError extends InsaneMissingParameterError{};
export class UnknownInsaneRunTimeError extends Error{};

interface SocketFile {
  file:Buffer,
  fileName:string
};

export interface SocketFileReadable {
  originalName: string,
  content     : Readable
};

export interface MembraneRunnerMolInputs {
  pdb:SocketFileReadable,
  top:SocketFileReadable,
  itps:SocketFileReadable[]
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

      // It doesnt work :-/
 /* if (Buffer.isBuffer(o.file))
      return false;*/
  
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
/**
 * 
 * @param data An Insane input file collection object
 * @returns An equivalent object with Buffer converted into Readable and name parameter renamed originalName
 */
export const MembraneRunnerMolInputsAsReadable = (data:InsaneFilesInput):MembraneRunnerMolInputs =>{
  logger.debug(`[MembraneRunnerMolInputsAsReadable] converting:\n${inspect(data)}`);
  return { 
    pdb : {
      originalName: data.pdb.fileName,
      content     : InputTextWrapper( data.pdb.file)
      },
    top : {
      originalName: data.top.fileName,
      content     : InputTextWrapper( data.top.file)
      },
    itps : data.itps.map( (itp) =>{ return{originalName:itp.fileName, content:InputTextWrapper(itp.file)}} )
    };
}


// Test w/out input PDB API needs rehaul to accomadfate socket
export const membraneBuilderRunner = async (parameters: ClientInsaneSettingsDto, molecules?:MembraneRunnerMolInputs) => {

  logger.debug(`[membraneBuilderRunner] Receiving parameters:\n${inspect(parameters)}`);
  const molecule_id = parameters.from_id
  let force_field = parameters.force_field

  const tmp_dir = await TmpDirHelper.get();
  /*
  let membraneBuilder:undefined|MembraneBuilder = undefined;
  try {
    membraneBuilder = await MembraneBuilder.create();
  } catch (error) {
    logger.error(`[membraneBuilderRunner] MembraneBuilder creation failed ${error}`);
    throw new InsaneReadDefinitionError();
  }
  */
  const membraneBuilder = MembraneBuilder.create();

  const molecule_entries = {
    molecule_pdb: "",
    molecule_top: "",
    molecule_itps: [] as string[],
  };
  if (molecule_id) {
    logger.debug(`[membraneBuilderRunner]  molecule_id found`);
    // from molecule id
    const { pdb, itps, top } = await membraneBuilder.prepareRunWithDatabaseMolecule(molecule_id.toString());
    molecule_entries.molecule_itps = itps;
    molecule_entries.molecule_pdb = pdb;
    molecule_entries.molecule_top = top;
    //force_field = ff as AvailableForceField;
  } // m
  else {
    logger.debug(`[membraneBuilderRunner] no molecule_id found`);
    if (parameters.molecule_added) {
      if(!molecules)
        throw new InsaneMissingFilesError();

      logger.debug(`[membraneBuilderRunner] file added, fetching and copying them...`);
      // except them from files
      /*
       if (!files || !files.itp || !files.top || !files.pdb) {
         return Errors.throw(ErrorType.MissingFiles);
       }
       if (!files.itp.length || !files.top.length || !files.pdb.length) {
         return Errors.throw(ErrorType.MissingFiles);
       }
     */
      // todo test file size !
      
      const topPath = `${tmp_dir}/full.top`;
      await fsp.writeFile(topPath, molecules.top.content);
      molecule_entries.molecule_top = topPath;
      const pdbPath = `${tmp_dir}/output.pdb`;
      await fsp.writeFile(pdbPath, molecules.pdb.content);
      molecule_entries.molecule_pdb = pdbPath;

      // Symlink for itps
      for (const { originalName, content } of molecules.itps) {
        const tmpPath = originalName.endsWith('.itp') ? `${tmp_dir}/${originalName}` : `${tmp_dir}/${originalName}.itp`;
        await fsp.writeFile(tmpPath, content);
        molecule_entries.molecule_itps.push(tmpPath);
      }
      // ready !
    }

  }

  const { lipids, upper_leaflet } = insaneLipidSpecParser(parameters);
  const opts = insaneSettingsParser(parameters);

  if (!force_field)
    throw new InsaneMissingForceFieldParameterError();


  try {

    const { pdbWater, pdbNoWater, itps, top } = await membraneBuilder.run({
      force_field,
      lipids,
      upper_leaflet,
      ...molecule_entries,
      settings: opts,
    });

    const pdbFinalWaterPath = `${tmp_dir}/pdb_insane_system_water.pdb`;
    const pdbFinalNoWaterPath = `${tmp_dir}/pdb_insane_system_nowater.pdb`;
    const topFinalPath = `${tmp_dir}/pdb_insane_system.top`;
    logger.debug(`[MembraneBuilderRunner] Packing following files:\n${pdbFinalWaterPath}, ${pdbFinalNoWaterPath}, ${topFinalPath}`);
    await readableToFile(pdbWater, pdbFinalWaterPath);
    await readableToFile(pdbNoWater as Readable, pdbFinalNoWaterPath);
    await readableToFile(top, topFinalPath);

    return {
      // @ts-ignore
      water: await getFormattedFile(pdbFinalWaterPath),
      no_water: await getFormattedFile(pdbFinalNoWaterPath),
      top: await getFormattedFile(topFinalPath),
      itps: await Promise.all(itps.map(i => getFormattedFile(i))),
    };
  } catch (e:any) {
    logger.error(`[INSANE] Insane run failed:\n${e}`);
    if (e instanceof InsaneError)
      throw(e);
    const _ = new UnknownInsaneRunTimeError();
    _.message = _.message = e.message;
    throw(_);
  }
};

const insaneLipidSpecParser = (parameters: ClientInsaneSettingsDto) => {
  logger.debug(`[membraneBuilderRunner:insaneLipidSpecParser] starting`);
  let upper_leaflet: LipidMap = [];
  let lipids = undefined;
  if (parameters.lipids_added) {
    if (!parameters.lipids || !parameters.force_field) {
      throw new InsaneMissingLipidParameterError();
    } 

    // Parse lipid str
    lipids = (parameters.lipids as string).split(',').map(e => {
      const res = e.split(':');

      if (res.length > 1) {
        return [res[0], parseInt(res[1], 10)] as [string, number];
      }
      return [res[0], 1] as [string, number];
    }); 

    // If upper leaflet, parse it
    if (parameters.upper_leaflet) {
      upper_leaflet = (parameters.upper_leaflet as string).split(',').map(e => {
        const res = e.split(':');

        if (res.length > 1) {
          return [res[0], parseInt(res[1], 10)] as [string, number];
        }
        return [res[0], 1] as [string, number];
      });
    } 
  }
  return { upper_leaflet, lipids };
}

  const insaneSettingsParser = (parameters: ClientInsaneSettingsDto): Partial<InsaneSettings> => {
    logger.debug(`[membraneBuilderRunner:insaneSettingsParser] starting`);
    
    const opts: Partial<InsaneSettings> = {};
    // Parse settings
    opts.pbc = parameters.pbc;
    const items = (parameters.box as string).split(',').map(e => parseInt(e, 10));
    if (!items.every(e => !isNaN(e) && e >= 0)) {
      return Errors.throw(ErrorType.Format);
    }
    opts.box = items;

    // Handle rotate
    if (parameters.rotate !== 'none') {
      if (parameters.rotate === 'angle') {
        opts.rotate_angle = parameters.rotate_angle;
        opts.rotate = 'angle';
      }
      else {
        opts.rotate = parameters.rotate;
      }
    }

    if (parameters.molecule_added) {
      if (parameters.center) {
        opts.center = true;
      }
    }
    if (parameters.lipids_added && parameters.molecule_added) {
      if (parameters.orient) {
        opts.orient = true;
      }
    }

    opts.salt_concentration = parameters.salt_concentration;
    if (parameters.charge !== 0) {
      opts.charge = parameters.charge;
    }
    opts.solvent_type = parameters.solvent_type;
    return opts;
  }