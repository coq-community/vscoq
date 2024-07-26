import * as fs from "node:fs/promises";
import * as path from "path";
import * as tmp from "tmp-promise";

import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    const storagePath = await tmp.dir();
    const userDataDir = path.join(storagePath.path, "settings");
    const userSettingsPath = path.join(userDataDir, "User");

    const vscoqPath =
      process.env.VSCOQPATH ||
      path.resolve(
        __dirname,
        "../../../language-server/_build/install/default/bin/vscoqtop",
      );
    const vscoqArgs = process.env.VSCOQARGS?.split(" ");

    const userSettings = {
      "vscoq.path": vscoqPath,
      "vscoq.args": vscoqArgs,
      "vscoq.proof.mode": 1,
    };

    await fs.mkdir(userSettingsPath, { recursive: true });
    await fs.writeFile(
      path.join(userSettingsPath, "settings.json"),
      JSON.stringify(userSettings),
      "utf-8",
    );

    const launchArgs = [
      path.resolve(__dirname, "../../testFixture"),
      "--disable-extensions",
      "--user-data-dir=" + userDataDir,
    ];

    // Download VS Code, unzip it and run the integration test
    //const vscodeExecutablePath = await downloadAndUnzipVSCode('1.84.0');
    await runTests({
      // vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
    });
  } catch (err) {
    console.error("Failed to run tests");
    process.exit(1);
  }
}

main();
