import logger from "../../logger";

import { TokenPayload } from "../../types";
import { ReadedFile } from '../../Entities/entities/job';
import JsonWebToken from 'jsonwebtoken';
import { KEYS } from "../../constants";
import { Database } from "../../Entities/CouchHelper";


export function signToken(payload: TokenPayload, id: string) {
  return new Promise<string>((resolve, reject) => {
    // Signe le token
    JsonWebToken.sign(
      payload, // Données custom
      { key: KEYS.PRIVATE, passphrase: "" }, // Clé RSA privée
      { 
        algorithm: 'RS256', 
        expiresIn: "720d", // 2 years durability
        issuer: "MArtini Database Server 1", 
        jwtid: id, // ID généré avec snowflake
      }, 
      (err, encoded) => { // Quand le token est généré (ou non), accepte/rejette la promesse
        if (err) reject(err);
        else resolve(encoded as string);
      }
    );
  });// as Promise<string>;
}

export async function validateToken(token: string) {
  const payload: any = await new Promise((resolve, reject) => {
    JsonWebToken.verify(
      token, 
      { key: KEYS.PUBLIC, passphrase: "" }, 
      { algorithms: ['RS256'] }, 
      (err, payload: any) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(payload);
      }
    )
  });

  return getUserFromToken(payload.jti);
}

export function getUserFromToken(jti: string) {
  logger.debug(`[helper:getUserFromToken] for ${jti}`);
  // Get the token from string and call done(null, is_revoked)
  return Database.token.get(jti as string)
    .then(() => Database.user.fromToken(jti as string))
    .catch((e)=> {
      logger.error(`[helper:getUserFromToken] for ${jti} error:\"${e}\"`);
      throw(`Fail to get token from database for user ${jti}`)
    });
}
