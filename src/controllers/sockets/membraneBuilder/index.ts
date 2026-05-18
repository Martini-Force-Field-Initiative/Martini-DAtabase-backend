import logger from '../../../logger';
import { inspect } from 'util';
import { plainToInstance } from 'class-transformer';
import { ClientInsaneSettingsDto, FileDto } from '../../dto/membraneBuilder.dto';
import { isInstance, validateOrReject } from 'class-validator';
import { MembraneRunnerMolInputs, membraneBuilderRunner, InsaneMissingParameterError, InsaneError } from '../../common/membraneBuilder';
import { SocketController, ListenTo, SocketControllerRegister  } from 'socket-controller-rdy';
import { isInsaneFilesInput, MembraneRunnerMolInputsAsReadable, InsaneFilesInput }  from '../../common/membraneBuilder';




interface InsaneSettings {
    pdb:FileDto, 
    itps:FileDto[], 
    top:FileDto,
    parameters:ClientInsaneSettingsDto;
}

/*
Must be adapted to Zero upload files case
*/
class MissingParameters extends Error {}
class InsaneRunError extends Error {}

// This should be provided as a parameter decorator 4 validation
const processData = (data: any): InsaneSettings => {
    logger.debug(`[SOCKET:MembraneBuilder] Unwrapping following input :\n${inspect(data)}`);
    const maybeParameters: { [k: string]: string | number } = {}
    for (let k in data)
        if (!["pdb", "itp", "top"].includes(k))
            maybeParameters[k] = data[k]
    logger.debug(`[SOCKET:MembraneBuilder] Validating following parameters:\n${inspect(maybeParameters)}`);

    const parameters = plainToInstance(ClientInsaneSettingsDto, maybeParameters);
    // RESUME HERE  
    const validatedPdb = plainToInstance(FileDto, data.pdb)
    logger.debug("[SOCKET:MembraneBuilder:processData] Validation: pdb ok ...");
    logger.debug("SSS" + inspect(data.pdb));
    const validatedTop = plainToInstance(FileDto, data.top)
    logger.debug("[SOCKET:MembraneBuilder:processData] Validation: top ok ...");
    //logger.debug("[SOCKET:MembraneBuilder:processData] ????" + data.itp);
    const validatedItps = data.itp.map((itp:any) => plainToInstance(FileDto, itp));
    logger.debug("[SOCKET:MembraneBuilder:processData] Validation: itp(s) ok ...");
    logger.debug("[SOCKET:MembraneBuilder] Validation or Rejection");
    //logger.debug(validatedItps);
   

    return { parameters, pdb: validatedPdb, top: validatedTop, itps:validatedItps }
}





@SocketControllerRegister
export class MembraneBuilder extends SocketController{
   
    @ListenTo('insaneResult')
    async insaneSubmit(files:any, /*@InsaneParamValid*/ param:any){
        logger.debug(`[SOCKET::membraneBuilderRunner] \"insaneResult\" incoming packet.`);
        const parameters = plainToInstance(ClientInsaneSettingsDto, param);
        
        const molecule_inputs = isInsaneFilesInput(files)
            ? MembraneRunnerMolInputsAsReadable(files as InsaneFilesInput)
            : undefined;
            logger.debug("[SOCKET:MembraneBuilder: validated \"molecule_inputs\"");
        try {
            const data = await membraneBuilderRunner(parameters, molecule_inputs);
            logger.debug("[SOCKET:MembraneBuilder:insaneProcess] SUCCESSFULL");
            return data;

        } catch (e:any) {
            if (e instanceof InsaneMissingParameterError) {
                logger.debug(`[MembraneBuilder:insaneSubmit] InsaneMissingParameterError ${e}`);
                throw new MissingParameters("InsaneMissingParameterError");
            }
            if (e instanceof InsaneError) {
                logger.debug(`[MembraneBuilder:insaneSubmit] InsaneError ${e}`);
                throw(e)
             }
            logger.error(`[MembraneBuilder:insaneSubmit] FATAL unknwon Error: ${e}`)
            throw new InsaneRunError(e.message);
        }
    }
}


