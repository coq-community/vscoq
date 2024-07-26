import { expect } from "expect";
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import * as common from "./common";

suite("Should get diagnostics", function () {
  this.timeout(30000);

  test("Diagnoses an undefined ref error", async () => {
    const ext = vscode.extensions.getExtension("maximedenes.vscoq")!;
    await ext.activate();

    const doc = await common.openTextFile("basic.v");

    await common.sleep(10000); // Wait for server initialization

    const diagnostics = vscode.languages.getDiagnostics(doc);

    expect(diagnostics.length).toBe(1);

    const diagnostic = diagnostics[0];

    expect(diagnostic.message).toMatch(/The reference zar was not found.*/);

    expect(diagnostic.severity).toBe(vscode.DiagnosticSeverity.Error);
  });

  test("Opens two files and gets feedback", async () => {
    const ext = vscode.extensions.getExtension("maximedenes.vscoq")!;
    await ext.activate();

    const doc1 = await common.openTextFile("basic.v");
    const doc2 = await common.openTextFile("warn.v");

    await common.sleep(10000); // Wait for server initialization

    const diagnostics1 = vscode.languages.getDiagnostics(doc1);
    const diagnostics2 = vscode.languages.getDiagnostics(doc2);

    expect(diagnostics1.length).toBe(1);
    expect(diagnostics2.length).toBe(1);
  });
});
