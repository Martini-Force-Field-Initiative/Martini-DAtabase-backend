
/* A container describing the bindings bewteen subcommands and their help messages  and their callback*/
/* requires a injector method in interactive-cli-heper */

export interface CliSubcommandDescriptors {
    commands : Record<string, string>,
  //  onNoMatch: string,
    execute : Record<string, (rest:string)=>string|Promise<string>>,
}

export abstract class CliSubcommand {
    /* ---- [ NB ] sub command code is declared inside child constuctor -----
    constructor() {
        super();
        this.command("hello", "say hello",
            async() => {           
                const mols = await shake();
                return "hello there"
            }
        );
    }
    */
    register:Record<string, [help:string, (rest:string)=>string|Promise<string>] > = {};
    command(cmdName:string, help:string, command:(rest:string)=>string|Promise<string>){
        this.register[cmdName] = [help, command];
    };
    get subCommands():CliSubcommandDescriptors {
        const commands:Record<string, string> = {};
        const execute:Record<string, (rest:string)=>string|Promise<string>> = {};
        for (let cmdName in this.register) {
            commands[cmdName] = this.register[cmdName][0];
            execute[cmdName]  = this.register[cmdName][1];
       }
        return { commands, execute };
    }
};