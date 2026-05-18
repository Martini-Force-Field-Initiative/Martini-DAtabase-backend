import { Router } from 'express';
import { errorCatcher, methodNotAllowed, sanitize } from '../../../helpers/simple';
import Errors, { ErrorType } from '../../../Errors';
import { Database } from '../../../Entities/CouchHelper';
import { inspect } from 'util';
import logger from '../../../logger';
import { Request as JWTRequest } from "express-jwt";
const ValidateUserRouter = Router();

ValidateUserRouter.get('/', (req:JWTRequest, res) => {
  (async () => {
    logger.info( "ValidateUserRouter request Inc")
    //logger.info(inspect(req));
    logger.debug(`[ValidateUserRouter] request Inc w/ auth:\n${inspect(req.auth)}`);
    if (!req.auth?.jti)
      //return res.sendStatus(401); 
      return Errors.throw(ErrorType.JWTRequestMalformed);
    const user = await Database.user.fromToken(req.auth.jti);
    if (!user) {
      return Errors.throw(ErrorType.Forbidden);
    }
    if (!user.approved) {
      return Errors.throw(ErrorType.UserNotApproved);
    }
    logger.debug("Validation seems ok");
    res.json(sanitize({ ...user, password: null }));
  })().catch(errorCatcher(res));
});

ValidateUserRouter.all('/', methodNotAllowed('GET'));

export default ValidateUserRouter;
