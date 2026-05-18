import { Router } from 'express';
import { methodNotAllowed, errorCatcher, cleanMulterFiles } from '../../../../helpers/simple';
import Uploader from '../../Uploader';
import { promises as FsPromise } from 'fs';
import { PbcString, AvailablePbcStrings, InsaneError } from '../../../../Builders/MembraneBuilder';
import Errors, { ErrorType } from '../../../../Errors';
import { InputTextWrapper } from '../../../../helpers/inputs';
import { inspect } from 'util';
import { plainToInstance } from 'class-transformer';
import path from 'path';
import { validateOrReject } from 'class-validator';
import logger from '../../../../logger';
import { ClientInsaneSettingsDto, FileDto } from '../../../dto/membraneBuilder.dto';
import { MembraneRunnerMolInputs, membraneBuilderRunner, InsaneMissingParameterError } from '../../../common/membraneBuilder';

export const MembraneBuilderRouter = Router();

// Middleware that wipe uploaded files after request
MembraneBuilderRouter.use((req, res, next) => {
  function after() {
    // Response is sended
    cleanMulterFiles(req);
    res.removeListener('finish', after);
  }

  res.once('finish', after);
  next();
});

// Items automatically coerced to numbers when presents
const VALID_BODY_ITEMS = [
  'area_per_lipid', 
  'area_per_lipid_upper',
  'random_kick_size',
  'bead_distance',
  'grid_spacing',
  'hydrophobic_ratio',
  'fudge',
  'shift_protein',
] as const;

MembraneBuilderRouter.post('/', Uploader.fields([
    { name: 'itp', maxCount: 99 }, 
    { name: 'top', maxCount: 1 },
    { name: 'pdb', maxCount: 1 }, 
  ]), (req, res) => {
    
    (async () => {
      
      // Init
     
      const validatedParams = plainToInstance(ClientInsaneSettingsDto, req.body);
      //Validate file names
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      logger.debug(`[MembraneBuilderRouter] Receiving Files\n${inspect(files)}`);
     // logger.debug()
      const molecule_inputs:Partial<MembraneRunnerMolInputs> = {};
      if(Object.keys(files).length > 0) {
        if(files.pdb.length > 1) return Errors.throw(ErrorType.TooManyFiles)
        if(files.top.length > 1) return Errors.throw(ErrorType.TooManyFiles)
        const validatedPdb = plainToInstance(FileDto, files.pdb[0])
        const validatedTop = plainToInstance(FileDto, files.top[0])
        const validatedItps = files.itp.map(itp => plainToInstance(FileDto, itp))
        logger.debug("Here " + inspect(files.itp));
        logger.debug("there " + inspect(validatedItps));
        try {
          await validateOrReject(validatedParams); 
          await validateOrReject(validatedPdb); 
          await validateOrReject(validatedTop); 
          await Promise.all(validatedItps.map(dto => validateOrReject(dto)))
        } catch(e) {
          res.status(400).json({ error: true, statusCode: 400, errorCode: 'PARAMS_VALIDATION_ERROR', e })
          return; 
        }
        molecule_inputs.pdb = {
          originalName : validatedPdb.originalname,
          //@ts-ignore
          content : InputTextWrapper(validatedPdb.path)
        }
        molecule_inputs.top = {
          originalName : validatedTop.originalname,
          //@ts-ignore
          content : InputTextWrapper(validatedTop.path)
        }
        molecule_inputs.itps = validatedItps.map( (itp) => { return {
            originalName : itp.originalname,
            //@ts-ignore
            content : InputTextWrapper(itp.path)
          }});
      }
      try {
        const data = await membraneBuilderRunner(validatedParams, molecule_inputs as MembraneRunnerMolInputs);
        res.json(data);
      } catch(e){
        if (e instanceof InsaneMissingParameterError) 
          return Errors.throw(ErrorType.MissingParameters);    
        if (e instanceof InsaneError) {
            res
              .status(400)
              .json({
                error: e.message,
                trace: e.trace,
                //zip: await Martinizer.zipDirectoryString(dir)
              });
          }
          else {
            logger.error(`[MembraneBuilderRouter] Fatal Error:\n${inspect(e)}`);
            throw e;
          }
        }
      })().catch(
        errorCatcher(res)
      )
  });
  
MembraneBuilderRouter.all('/', methodNotAllowed(['POST']));
