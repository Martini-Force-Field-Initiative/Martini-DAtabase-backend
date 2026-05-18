import { ItpTransformer, ItpModOptions } from "./meta_comments";
import { MulterLikeFile } from "../../types";
import { InputTextWrapper} from "../inputs";
import { promises as streamPromise, Writable } from  'stream';
import { createWriteStream, promises as FsPromise } from 'fs'
import logger from '../../logger';

/** Inject provided meta-inf in comment section of provided ITP file
* No check is performed on provided file
*/
export const addMetaTransform = async(input:MulterLikeFile, info:ItpModOptions, tgt?:string|Writable): Promise<void> => {
// 1 Check if passed file has all specified info   
   // const srcFilePath = `${input.path}/${input.originalname}`;
    logger.debug(`[helpers:itp:addMetaTransform] processing ${input.path}`);
    try {
    await streamPromise.pipeline(
        InputTextWrapper(input.path),
        await ItpTransformer.create(info, {}),
            createWriteStream(`${input.path}.swp`)
        );
    logger.debug(`[helpers:itp:addMetaTransform] created ${input.path}.swp`);
    await FsPromise.copyFile(`${input.path}.swp`, input.path);         
    logger.debug(`[helpers:itp:addMetaransform] Altered ITP comments section of ${input.path}`);
    } 
    catch (e) {
        logger.error(`[helpers:itp:addMetaTransform] error: '${e}'`);
    }
}