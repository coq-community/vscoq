import * as nfs from "fs";
import * as nzlib from "zlib";

export namespace fs {
  export function open(
    path: string | Buffer,
    flags: string | number
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      nfs.open(path, flags, (err: any, fd: number) => {
        if (err) reject(err);
        else resolve(fd);
      });
    });
  }

  export function writeFile(filename: string, data: any): Promise<void>;
  export function writeFile(
    filename: string,
    data: any,
    options: { encoding?: string; mode?: number; flag?: string }
  ): Promise<void>;
  export function writeFile(
    filename: string,
    data: any,
    options: { encoding?: string; mode?: string; flag?: string }
  ): Promise<void>;
  export function writeFile(
    filename: string,
    data: any,
    options?: any
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      nfs.writeFile(filename, data, options, (err: NodeJS.ErrnoException) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  export function readFile(filename: string, encoding: string): Promise<string>;
  export function readFile(filename: string): Promise<Buffer>;
  export function readFile(
    filename: string,
    options: { flag?: string }
  ): Promise<Buffer>;
  export function readFile(
    filename: string,
    options: { encoding: string; flag?: string }
  ): Promise<string>;
  export function readFile(...args: any[]): Promise<Buffer | string> {
    return new Promise<Buffer | string>((resolve, reject) => {
      nfs.readFile(args[0], args[1], (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  export function exists(path: string | Buffer): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      nfs.exists(path, ex => resolve(ex));
    });
  }

  export function stat(path: string | Buffer): Promise<nfs.Stats> {
    return new Promise<nfs.Stats>((resolve, reject) => {
      nfs.stat(path, (err, stats) => (err ? reject(err) : resolve(stats)));
    });
  }

  export function copyFile(src: string, dest: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        let called = false;
        const s = nfs.createReadStream(src);
        const d = nfs.createWriteStream(dest);
        function done(err: any) {
          s.destroy();
          d.end();
          if (called) return;
          called = true;
          reject(err);
        }
        s.on("error", done);
        d.on("error", done);
        d.on("finish", () => resolve());
        s.pipe(d);
      } catch (err) {
        reject(err);
      }
    });
  }
}

export namespace zlib {
  export function gunzip(data: Buffer, encoding = "utf8"): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      nzlib.gunzip(data, (err, data) => {
        if (err) reject(err);
        else resolve(data.toString(encoding));
      });
    });
  }
}
