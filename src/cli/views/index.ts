/*Reset = "\x1b[0m"
Bright = "\x1b[1m"
Dim = "\x1b[2m"
Underscore = "\x1b[4m"
Blink = "\x1b[5m"
Reverse = "\x1b[7m"
Hidden = "\x1b[8m"

FgBlack = "\x1b[30m"
FgRed = "\x1b[31m"
FgGreen = "\x1b[32m"
FgYellow = "\x1b[33m"
FgBlue = "\x1b[34m"
FgMagenta = "\x1b[35m"
FgCyan = "\x1b[36m"
FgWhite = "\x1b[37m"
FgGray = "\x1b[90m"

BgBlack = "\x1b[40m"
BgRed = "\x1b[41m"
BgGreen = "\x1b[42m"
BgYellow = "\x1b[43m"
BgBlue = "\x1b[44m"
BgMagenta = "\x1b[45m"
BgCyan = "\x1b[46m"
BgWhite = "\x1b[47m"
BgGray = "\x1b[100m"
*/


import{ render } from 'prettyjson';

const { Console } = require('console');
const { Transform } = require('stream');


// //https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color

export const bold = (msg:string, prev:string|undefined=undefined):string => {

    msg = `\x1b[1m${msg}\x1b[0m `
    if (prev)
        return `${prev}\n${msg}`;
    return msg;
}

const _flatColorMsg = (msg:string, colorCode:string, prev:string|undefined=undefined):string => {
    msg = `\x1b[${colorCode}${msg}\x1b[0m`
    if (prev)
        return `${prev}\n${msg}`;
    return msg;
}  

export const warn = (msg:string, prev:string|undefined=undefined):string => {
    return _flatColorMsg(msg, "31m", prev);
};

export const error = (msg:string, prev:string|undefined=undefined):string => {
    return _flatColorMsg(msg, "41m", prev);
}

export const success = (msg:string, prev:string|undefined=undefined):string => {
    return _flatColorMsg(msg, "32m", prev);
}

export const renderError = (elem:any):string => {
    return render(elem,
    {
        keysColor: 'red',
        dashColor: 'red',
        stringColor: 'red'
      }
    );
}






export const tablify = (input: {}[]): string => {
    /**
     * table([ { name: "Jane", id: '1234', pastime: 'Archery' },
     *         { name: "John", id: '1235', pastime: 'Knitting' } ]
     * )
     * returns following string:
     * ┌────────┬────────┬────────────┐
    *  │  name  │   id   │  pastime   │
    *  ├────────┼────────┼────────────┤
    *  │  Jane  │  1234  │  Archery   │   
    *  │  Jess  │  1236  │  Fishing   │
    *  └────────┴────────┴────────────┘
    */
   
    const ts = new Transform({ transform(chunk: any, enc: any, cb: any) { cb(null, chunk) } })
    const logger = new Console({ stdout: ts })
    logger.table(input)
    const table = (ts.read() || '').toString()
    let result = '';
    for (let row of table.split(/[\r\n]+/)) {
        let r = row.replace(/[^┬]*┬/, '┌');
        r = r.replace(/^├─*┼/, '├');
        r = r.replace(/│[^│]*/, '');
        r = r.replace(/^└─*┴/, '└');
        r = r.replace(/'/g, ' ');
        result += `${r}\n`;
    }
    return `\n${result}`;
}
