import { Router } from 'express';
import { errorCatcher, generateSnowflake, methodNotAllowed, sanitize } from '../../../helpers/simple';
import { signToken } from '../../../helpers/database/token';
import Errors, { ErrorType } from '../../../Errors';
import { Database } from '../../../Entities/CouchHelper';
import { Token, User } from '../../../Entities/entities';
import logger from '../../../logger';
import { inspect } from 'util';

const LoginUserRouter = Router();

LoginUserRouter.post('/', (req, res) => {
  (async () => {
    logger.debug(`[route:user:login] incoming request...`);
    if (!req.body) {
      Errors.throw(ErrorType.MissingParameters);
    } 
    logger.debug(`[route:user:login] \n${inspect(req.body)}`);

    let { username, password } = req.body as { username: string, password: string };

    if (!username || !password) {
      Errors.throw(ErrorType.MissingParameters);
    }

    let user: User | undefined;
    if (username.includes("@")) {
      user = await Database.user.fromEmail(username);
    }
    else {
      user = await Database.user.fromUsername(username);
    }
    if (!user) {
      return Errors.throw(ErrorType.UserNotFound);
    }
    logger.debug(`[route:user:login] user \"${username}\" found in db:${inspect(user)}`);
  
    const is_connected = await Database.user.verifyPassword(user, password);

    if (!is_connected) {
      logger.warn(`[route:user:login] user \"${username}\" invalid password \"${password}\"\n`);
      Errors.throw(ErrorType.InvalidPassword);
    }
    logger.debug(`[route:user:login] user \"${username}\"  isconnected:${is_connected}`);
    if (!user.approved) {
      return Errors.throw(ErrorType.UserNotApproved);
    }
    logger.debug(`[route:user:login] Creating token...`);
    // Create a token for this user
    const token: Token = {
      id: generateSnowflake(),
      user_id: user.id,
      created_at: new Date().toISOString(),
    }; 
    
    await Database.token.save(token);

    // Create the encoded JSON Web Token
    const jwt = await signToken({ user_id: token.user_id, created_at: token.created_at }, token.id);

    res.json({
      token: jwt,
      user: sanitize(user)
    });
  })().catch(errorCatcher(res));
});

LoginUserRouter.all('/', methodNotAllowed('POST'));

export default LoginUserRouter;
