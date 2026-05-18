
import { Router } from 'express';
import { THUMBNAILS_DIR } from '../../../constants';
import logger from '../../../logger';

const polymerGeneratorRouter = Router();

polymerGeneratorRouter.get("/thumbnails/:moleculeFile", (req,res)=>{
    logger.debug(`[polymerGeneratorRouter] thumbnails request incoming...`);
    const molecule = req.params.moleculeFile;
    logger.debug(`[polymerGeneratorRouter] thumbnails sending ${THUMBNAILS_DIR}/${molecule}`);
    res.sendFile(`${THUMBNAILS_DIR}/${molecule}`);
});

export default polymerGeneratorRouter;
