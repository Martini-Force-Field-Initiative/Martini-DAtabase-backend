import logger from "../logger";
import { Molecule, BaseMolecule } from "../Entities/entities";
import { simpleflake } from "simpleflakes";
import Errors, { ApiError, ErrorType } from "../Errors";
import Express from "express";
import { ReadedFile } from "../Entities/entities/job";
import { UPLOAD_ROOT_DIR } from "../constants";
import { unlink } from "fs";
import fs, { promises as FsPromise, existsSync } from "fs";
import path from "path";

export function isDebugMode() {
  return logger.level === "debug" || logger.level === "silly";
}

export function isMolecule(e: BaseMolecule): e is Molecule {
  return "approved_by" in e;
}

export function generateSnowflake() {
  return simpleflake(undefined, undefined, Date.UTC(2020, 0, 1)).toString(10);
}

export function sendError(error: ApiError, res: Express.Response) {
  res.status(Number(error.message)).json(error.data);
}

export function cleanMulterFiles(req: Express.Request) {
  if (req.files) {
    if (Array.isArray(req.files)) {
      for (const file of req.files) {
        unlink(file.path, () => {});
      }
    } else {
      for (const files of Object.values(req.files)) {
        for (const file of files) {
          unlink(file.path, () => {});
        }
      }
    }
  }
  if (req.file) {
    unlink(req.file.path, () => {});
  }
}

/**
 * Create a closure to catch an ApiError that occurs in a Promise.
 */
export function errorCatcher(res: Express.Response, req?: Express.Request) {
  return function (err: any) {
    if (req) {
      cleanMulterFiles(req);
    }

    if (res.headersSent) {
      return;
    }

    if (err instanceof ApiError) {
      return sendError(err, res);
    }

    if (err instanceof Error) {
      logger.error(
        "During request handling, the following error occurred: " +
          err +
          "\n" +
          err.stack,
      );
    } else if (typeof err === "string") {
      logger.error("Unknown error: " + err);
    } else if (Array.isArray(err)) {
      logger.error("Unknown error: " + err.join(", "));
    } else if (err) {
      logger.error(
        "Unknown error: " +
          JSON.stringify(Object.getOwnPropertyDescriptors(err), null, 2),
      );
    } else {
      logger.error("Unknown error (undefined)");
    }

    return sendError(Errors.make(ErrorType.Server), res);
  };
}

export function sanitize(obj: any) {
  const props = [] as string[];

  for (const prop in obj) {
    if (prop.startsWith("_")) {
      props.push(prop);
    }
  }

  for (const prop of props) {
    delete obj[prop];
  }

  return obj;
}

export function methodNotAllowed(allow: string | string[]) {
  return (_: any, res: Express.Response) => {
    res.setHeader(
      "Allow",
      typeof allow === "string" ? allow : allow.join(", "),
    );
    Errors.throw(ErrorType.InvalidMethod);
  };
}

export function getNameAndPathOfUploadedFile(name: string): [string, string] {
  const file_name = name.includes("/") ? name.split("/").pop()! : name;
  const file_path = UPLOAD_ROOT_DIR + file_name;

  return [file_name, file_path];
}

export function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withRegex(
  text: string,
  is_regex: boolean,
  flags = "i",
  strict_match = false,
) {
  let search_text = is_regex ? text : escapeRegExp(text);

  if (strict_match) {
    search_text = "^" + search_text + "$";
  }

  return { $regex: `(?${flags})${search_text}` };
}

// Example: 4.700000e-01    4.990000e+00
export function vanDerWaalsRadius(
  lennar_johns_1: number,
  lennar_johns_2: number,
) {
  const T = 0.191,
    S = 0.23,
    R = 0.254;
}

export async function dumpStdFromDir(dir: string) {
  // Can for .stdout and .stderr files
  const stderr: any = {};
  const stdout: any = {};

  for (const file of await FsPromise.readdir(dir)) {
    if (file.endsWith(".stdout")) {
      const name = file.slice(0, file.length - ".stdout".length);
      stdout[name] = await FsPromise.readFile(dir + "/" + file, "utf-8");
    } else if (file.endsWith(".stderr")) {
      const name = file.slice(0, file.length - ".stderr".length);
      stderr[name] = await FsPromise.readFile(dir + "/" + file, "utf-8");
    }
  }

  return { stdout, stderr };
}

/**
 * Get the basename of a file without the extension.
 */
export function basenameWithoutExt(src: string) {
  const basename = path.basename(src);
  const last_dot = basename.lastIndexOf(".");

  if (last_dot !== -1) {
    return basename.slice(0, last_dot);
  }
  return basename;
}

/**
 * Create a type that contain values from an array (known at compile-time).
 *
 * Usage:
 * ```ts
 * const MY_VALUES = ['v1', 'v2', 'v3'] as const;
 *
 * type AvailableValues = ArrayValues<typeof MY_VALUES>;
 * // AvailableValues = 'v1' | 'v2' | 'v3'
 * ```
 */
export type ArrayValues<T extends ReadonlyArray<unknown>> =
  T extends ReadonlyArray<infer ArrayValues> ? ArrayValues : never;

export function fileExists(path: string) {
  return FsPromise.access(path, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

/**
 * Formate un objet Date en chaîne de caractères potable.
 * Pour comprendre les significations des lettres du schéma, se référer à : http://php.net/manual/fr/function.date.php
 * @param schema string Schéma de la chaîne. Supporte Y, m, d, g, H, i, s, n, N, v, z, w
 * @param date Date Date depuis laquelle effectuer le formatage
 * @returns string La chaîne formatée
 */
export function dateFormatter(schema: string, date = new Date()): string {
  function getDayOfTheYear(now: Date): number {
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    const day = Math.floor(diff / oneDay);

    return day - 1; // Retourne de 0 à 364/365
  }

  const Y = date.getFullYear();
  const N = date.getDay() === 0 ? 7 : date.getDay();
  const n = date.getMonth() + 1;
  const m = (n < 10 ? "0" : "") + String(n);
  const d = (date.getDate() < 10 ? "0" : "") + String(date.getDate());
  const L = Y % 4 === 0 ? 1 : 0;

  const i = (date.getMinutes() < 10 ? "0" : "") + String(date.getMinutes());
  const H = (date.getHours() < 10 ? "0" : "") + String(date.getHours());
  const g = date.getHours();
  const s = (date.getSeconds() < 10 ? "0" : "") + String(date.getSeconds());

  const replacements: any = {
    Y,
    m,
    d,
    i,
    H,
    g,
    s,
    n,
    N,
    L,
    v: date.getMilliseconds(),
    z: getDayOfTheYear,
    w: date.getDay(),
  };

  let str = "";

  // Construit la chaîne de caractères
  for (const char of schema) {
    if (char in replacements) {
      if (typeof replacements[char] === "string") {
        str += replacements[char];
      } else if (typeof replacements[char] === "number") {
        str += String(replacements[char]);
      } else {
        str += String(replacements[char](date));
      }
    } else {
      str += char;
    }
  }

  return str;
}

export async function getFormattedFile(file: string): Promise<ReadedFile> {
  const name = path.basename(file);
  const type = detectType(file.slice(file.indexOf(".") + 1));

  return {
    name,
    type,
    content: await FsPromise.readFile(file, "utf-8"),
  };
}

function detectType(ext: string) {
  switch (ext) {
    case "itp":
      return "chemical/x-include-topology";
    case "top":
      return "chemical/x-topology";
    case "pdb":
      return "chemical/x-pdb";
  }
  return "";
}

export function rtrim(x: string, characters: string) {
  let end = x.length - 1;
  while (characters.indexOf(x[end]) >= 0) {
    end -= 1;
  }
  return x.substr(0, end + 1);
}

export function isLiteralObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" && // must be an object
    value !== null && // exclude null
    !Array.isArray(value) && // exclude arrays
    Object.getPrototypeOf(value) === Object.prototype // literal object
  );
}
