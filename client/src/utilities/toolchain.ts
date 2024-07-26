import { exec } from "child_process";
import * as path from "path";
import { workspace } from "vscode";
import { Disposable } from "vscode-languageclient";
import { ServerOptions } from "vscode-languageclient/node";
import Client from "../client";
import { isFileInFolder } from "./fileHelper";

export enum ToolChainErrorCode {
  notFound = 1,
  launchError = 2,
}

export interface ToolchainError {
  status: ToolChainErrorCode;
  message: string;
}

export default class VsCoqToolchainManager implements Disposable {
  private _vscoqtopPath: string = "";
  private _coqVersion: string = "";
  private _versionFullOutput: string = "";
  private _coqPath: string = "";

  public dispose(): void {}

  public intialize(): Promise<void> {
    Client.writeToVscoq2Channel("[Toolchain] Searching for vscoqtop");
    return new Promise((resolve, reject: (reason: ToolchainError) => void) => {
      this.vscoqtopPath().then((vscoqtopPath) => {
        if (vscoqtopPath) {
          Client.writeToVscoq2Channel(
            "[Toolchain] Found path: " + vscoqtopPath,
          );
          this._vscoqtopPath = vscoqtopPath;
          this.vscoqtopWhere().then(
            () => {
              resolve();
            },
            (err: ToolchainError) => {
              reject(err);
            },
          );
        } else {
          Client.writeToVscoq2Channel("[Toolchain] Did not find vscoqtop path");
          reject({
            status: ToolChainErrorCode.notFound,
            message:
              "VsCoq couldn't launch because no language server was found. You can install the language server (requires Coq 8.18 or higher) or use VsCoq Legacy.",
          });
        }
      });
    });
  }

  public getServerConfiguration(): ServerOptions {
    const config = workspace.getConfiguration("vscoq");
    const serverOptions: ServerOptions = {
      command: this._vscoqtopPath,
      args: config.args,
      options: {
        cwd: workspace.rootPath,
        shell: true,
      },
    };
    return serverOptions;
  }

  public getVsCoqTopPath(): string {
    return this._vscoqtopPath;
  }

  public getCoqPath(): string {
    return this._coqPath;
  }

  public getCoqVersion(): string {
    return this._coqVersion;
  }

  public getversionFullOutput(): string {
    return this._versionFullOutput;
  }

  private getEnvPath(): string {
    if (process.platform === "win32") {
      return process.env.Path ?? "";
    } else {
      return process.env.PATH ?? "";
    }
  }

  private splitEnvPath(value: string): string[] {
    return value.split(path.delimiter);
  }

  private async vscoqtopPath(): Promise<string> {
    const vscoqtopPath = workspace
      .getConfiguration("vscoq")
      .get("path") as string;
    if (vscoqtopPath) {
      return vscoqtopPath;
    } else {
      return await this.searchForVscoqtopInPath();
    }
  }

  private async searchForVscoqtopInPath(): Promise<string> {
    const pathVars = this.splitEnvPath(this.getEnvPath());
    for (let i in pathVars) {
      Client.writeToVscoq2Channel("[Toolchain] " + pathVars[i]);
      if (await isFileInFolder("vscoqtop", pathVars[i])) {
        return pathVars[i] + "/vscoqtop";
      }
    }
    return "";
  }

  // Launch the vscoqtop -where command with the found exec and provided args
  private vscoqtopWhere(): Promise<void> {
    const config = workspace.getConfiguration("vscoq").get("args") as string[];
    const options = ["-where"].concat(config);
    const cmd = [this._vscoqtopPath].concat(options).join(" ");

    return new Promise((resolve, reject: (reason: ToolchainError) => void) => {
      exec(cmd, { cwd: workspace.rootPath }, (error, stdout, stderr) => {
        if (error) {
          reject({
            status: ToolChainErrorCode.launchError,
            message: `${this._vscoqtopPath} crashed with the following message: ${stderr}
                        This could be due to a bad Coq installation or an incompatible Coq version.`,
          });
        } else {
          this._coqPath = stdout;
          this.coqVersion().then(
            () => {
              resolve();
            },
            (err) => {
              reject({
                status: ToolChainErrorCode.launchError,
                message: `${this._vscoqtopPath} crashed with the following message: ${err}.
                                This could be due to a bad Coq installation or an incompatible Coq version`,
              });
            },
          );
        }
      });
    });
  }

  private coqVersion(): Promise<void> {
    const config = workspace.getConfiguration("vscoq").get("args") as string[];
    const options = ["-v"].concat(config);
    const cmd = [this._vscoqtopPath].concat(options).join(" ");

    return new Promise((resolve, reject: (reason: string) => void) => {
      exec(cmd, { cwd: workspace.rootPath }, (error, stdout, stderr) => {
        if (error) {
          reject(stderr);
        } else {
          const versionRegexp = /\b\d\.\d+(\.\d|\+rc\d)\b/g;
          this._versionFullOutput = stdout;
          const matchArray = stdout.match(versionRegexp);
          if (matchArray) {
            this._coqVersion = matchArray[0];
          }
          resolve();
        }
      });
    });
  }
}
