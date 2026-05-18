import { Router } from 'express';
import { errorCatcher } from '../../../helpers/simple';
import { readableToStringMany, unzipReadable } from '../../../helpers/inputs';
import logger from '../../../logger';

import DatabaseMoleculeDesk from '../../../helpers/database/molecule';


import MoleculeOrganizer from '../../../MoleculeOrganizer';
import Errors, { ErrorType } from '../../../Errors';
import { Database } from '../../../Entities/CouchHelper';
import StreamZip from 'node-stream-zip';
import { MangoQuery } from 'nano';
import { inspect } from 'util';

// Get a pdb from a file ID
const GetMoleculeAPI = Router();

//eg : http://localhost:8080/api/molecule/get/test/titi
GetMoleculeAPI.get('/alias/:moleculeAlias', async (req,res)=>{
  /**
   * Returns ths files bundle of queried molecule
   * - main selector is the molecule Alias
   * - allowed query parameters are "ff", "version", 
   * eg : "/api/molecule/get/alias/POPC?ff=martini3001&version=1.0"
   * by default, the latest model is provided
   * eg: "/api/molecule/get/alias/POPC", will return the latest model of the latest forcefield or the model bearing the "latest" tag
   */
  logger.info(inspect(req.query));
  try {
    const bundleFile = await DatabaseMoleculeDesk.getUniqZipModel({ ...req.query, alias:req.params.moleculeAlias });
    const name       = 'force_field' in req.query ? `${req.params.moleculeAlias}:${req.query.force_field}_v${req.query.version}.zip` : `${req.params.moleculeAlias}_latest.zip`
    res.download(bundleFile, name);
  } catch(e:any) {
    res.send({"error" : e.message});
  }
 // res.send(req.params.moleculeAlias);//req.params.alias;
 
});


GetMoleculeAPI.get('/id/:id', async (req,res)=>{
  logger.info(inspect(req.query));
  try {
    const bundleFile = await DatabaseMoleculeDesk.getUniqZipModel({ id:req.params.id });
    res.download(bundleFile, `${req.params.id}.zip`);
  } catch(e:any) {
    res.send({"error" : e.message});
  }
 
});


//If format isnt provided give the last update of this model 
// eg: http://localhost:8080/api/molecule/get/martini3001
GetMoleculeAPI.get('/:forcefield/:id.:format?/:version?', (req, res) => {
  (async () => {
    logger.info(`[GetMoleculeAPI] ${inspect(req.params)}`);
    const selectruc: MangoQuery = { selector: { alias: req.params.id, force_field: req.params.forcefield } }
    if (req.params.version) {
      selectruc.selector["version"] = req.params.version
    }
    logger.info(`[GetMoleculeAPI] molecule.find(${inspect(selectruc)})`);
    const molcouch = await Database.molecule.find(selectruc)


    // File does not exists
    if (molcouch.length === 0) {
      return Errors.throw(ErrorType.ElementNotFound);
    }

    const molecule = await MoleculeOrganizer.getInfo(molcouch[0].files);

    logger.info(`[GetMoleculeAPI] molcouch[0].files ${molcouch[0].files}`);
    const zip = new StreamZip({
      file: MoleculeOrganizer.getFilenameFor(molcouch[0].files),
      storeEntries: true,
      skipEntryNameValidation: true
    });
    logger.info(`[GetMoleculeAPI] Found, zipping out!`);
    const _ = await new Promise<void>((resolve, reject)  => {
      zip.on('ready', ()=> {
        logger.info("[GetMoleculeAPI] Found, zipping RDY!");
        resolve();});
      zip.on('error', reject);
    });
    
    if (req.params.format === "itp") {
      const itp_streams = await Promise.all(molecule!.itp.map(itp_file => unzipReadable(itp_file.name, zip)))
      const itp_finals = await Promise.all(readableToStringMany(itp_streams))
      logger.info(`[GetMoleculeAPI]::itp Sending ${itp_finals[0]}`);
      res.send(itp_finals[0]);
    }
    else if (req.params.format === "pdb") {
      const pdb_stream = await unzipReadable(molecule!.pdb!.name, zip)
      const pdb_final = await Promise.all(readableToStringMany([pdb_stream]))
      logger.info(`[GetMoleculeAPI]::pdb Sending ${pdb_final[0]}`);
      res.send(pdb_final[0]);
    }
    else if (req.params.format === "gro") {
      if (molecule!.gro) {
        const gro_stream = await unzipReadable(molecule!.gro!.name, zip)
        const gro_final = await Promise.all(readableToStringMany([gro_stream]))
        logger.info(`[GetMoleculeAPI]::pdb Sending ${gro_final[0]}`);
        res.send(gro_final[0]);
      }
      else {
        logger.error(`[GetMoleculeAPI]::gro \".gro not found\"`);
        res.status(404).json({ "error": ".gro not found." });
      }

    }
    else if ((req.params.format === undefined) || (req.params.format === "zip")) {
      const filename = MoleculeOrganizer.getFilenameFor(molcouch[0].files);
      res.download(filename);
    }
    else {
      logger.error(`[GetMoleculeAPI] Format .${req.params.format} unkown.`);
      res.send({ "error": "Format ." + req.params.format + " unkown." })
    }
  })().catch(errorCatcher(res));
});

export default GetMoleculeAPI;