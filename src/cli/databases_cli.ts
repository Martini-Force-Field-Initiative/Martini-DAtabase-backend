import CliHelper, { CliListener } from "mad-cli";
import { Database } from "../Entities/CouchHelper";
import AbstractDatabase from "../Entities/AbstractDatabase";
import { render } from 'prettyjson';
import DatabaseMoleculeDesk from "../helpers/database/molecule";
import { warn, success, bold, error, renderError } from './views';
import { createWriteStream } from "node:fs";

const DATABASE_CLI = new CliListener(
  CliHelper.formatHelp("database", {
    commands: {
      'create <name>/all': 'Create a single or all databases. Available names are: ' + Database.symbols.join(', ') + '.',
      'wipe <name>/all'  : 'Delete a single or all databases.',
      'info'             : 'Check existence of each database and show their document count.',
      'get <database> <docId>': 'Get a document by id in a selected database.',
    },
    onNoMatch: "Command is incorrect. Type \"database\" for help.",
  })
);
DATABASE_CLI.command('endpoints', ()=>{
  return render(Database.addr);
})
DATABASE_CLI.command('create', async rest => {
  rest = rest.trim();
  
  if (!rest) {
    return `Please specify a database name or "all".`;
  }

  if (rest === "all") {
    await Database.createAll();
    return "All databases has been created.";
  }
  if (!Database.symbols.includes(rest)) {
    return `This database name is not authorized. Available names are ${Database.symbols.join(', ')}.`;
  }
  await Database.create(rest, true);
  return `Database ${rest} has been created.`;
});

DATABASE_CLI.command('wipe', async rest => {
  rest = rest.trim();
  
  if (!rest) {
    return `Please specify a database name or "all".`;
  }

  if (rest === "all") {
    await Database.deleteAll();
    return "All databases has been wiped.";
  }
  if (!Database.symbols.includes(rest)) {
    return `This database name is not authorized. Available names are ${Database.symbols.join(', ')}.`;
  }
  await Database.delete(rest);
  return `Database ${rest} has been wiped.`;
});

DATABASE_CLI.command('get', async rest => {
  const [database, id] = rest.split(/ +/);
  if (!database || !id) {
    return `You must specify database name and id. Available names are ${Database.symbols.join(', ')}.`;
  }

  return Database.link.use(database).get(id);
});

DATABASE_CLI.command('info', async () => {
  // Show: Database info (document count in each)
  async function infoAbout(database: AbstractDatabase<any>) {
    return {
      count: await database.count().catch(e => 0),
      created: await database.isCreated(),
    };
  }
  
  function formatInfo(name: string, infos: { count: number, created: boolean }) {
    return `${name}\n\tcreated:\t${infos.created}\n\tdoc_count:\t${infos.count}`;
  }

  return '\n' + (
    await Promise.all(
      [
        [Database.addr.user, Database.user],
        [Database.addr.token, Database.token],
        [Database.addr.molecule, Database.molecule],
        [Database.addr.stashed, Database.stashed],
        [Database.addr.radius, Database.radius]/*,
        [Database.addr.lipid, Database.lipid],*/
      ]
      .map(async e => formatInfo(e[0] as string, await infoAbout(e[1] as AbstractDatabase<any>)))
    )
  ).join('\n');
});

DATABASE_CLI.command('archive', async (rest) => {
  const zipArch = await DatabaseMoleculeDesk.archive();
  const zipFileOut = `${rest}.zip`;
  return new Promise((resolve, reject) => {
    zipArch.generateNodeStream({type:'nodebuffer',streamFiles:true})
    .pipe(createWriteStream(zipFileOut))
    .on('finish', function () {
    // JSZip generates a readable stream with a "end" event,
    // but is piped here in a writable stream which emits a "finish" event.
      resolve(success(`${zipFileOut} written.`));
    });
  });
});

export default DATABASE_CLI;
