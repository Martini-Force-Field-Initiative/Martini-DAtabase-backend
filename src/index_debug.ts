import dotenv from 'dotenv';
import { inspect } from 'util';
import { ApiError } from './Errors';
const conf = dotenv.config({ path: __dirname + "/../.env" })
if (conf.error) {
  console.error("Error while loading conf. Verify or create .env file")
  console.error("Stack trace:", 'stack' in conf.error ? conf.error : conf.error)
  process.exit(2)
}

import commander from 'commander';
import { VERSION, URLS, DEFAULT_TMP_BASE_DIR, MAINTENANCE } from './constants';
import logger, { toggleLogToFile } from './logger';
import { Database } from './Entities/CouchHelper';

class CustomError extends Error {
  constructor(message: string) {
      super(message); // Call the constructor of the base class `Error`
      this.name = "CustomError"; // Set the error name to your custom error class name
// Set the prototype explicitly to maintain the correct prototype chain
      Object.setPrototypeOf(this, CustomError.prototype);
  }
}


commander 
  .option('-l, --log-level <logLevel>', 'Log level [debug|silly|verbose|info|warn|error]', /^(debug|silly|verbose|info|warn|error)$/, 'info') 
  .requiredOption('--ns <dbPrefix>', 'set databases prefix (optional)', String)  
  .parse(process.argv);

/* ------------------------------------------------- */
/* - STARTING THE SERVER AND LISTENING TO REQUESTS - */
/* ------------------------------------------------- */
if (commander.logLevel)   
  logger.level = commander.logLevel;

(async () => {
  try {
    await Database.ping();
  } catch (e: any) {
    logger.error(`CouchDB is not running or is unreachable: ${e}`);
    process.exit(2);
  }
  // statements…
})();
//Database.ping().then().catch((e) => console.error(e));