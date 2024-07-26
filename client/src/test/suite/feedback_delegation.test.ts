import { expect } from "expect";
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import * as common from "./common";

suite("Should get diagnostics in the appropriate tab", function () {
  this.timeout(20000);

  test("Delegating proofs", async () => {
    const ext = vscode.extensions.getExtension("maximedenes.vscoq")!;
    await ext.activate();

    vscode.workspace
      .getConfiguration()
      .update("vscoq.proof.delegation", "Delegate");

    const doc1 = await common.openTextFile("delegate_proof.v");
    const doc2 = await common.openTextFile("warn.v");

    await common.sleep(10000); // Wait for server initialization

    const diagnostics1 = vscode.languages.getDiagnostics(doc1);
    const diagnostics2 = vscode.languages.getDiagnostics(doc2);

    expect(diagnostics1.length).toBe(2);
    expect(diagnostics1[1].message).toMatch(/.*foobar was not found.*/);
    expect(diagnostics1[1].severity).toBe(vscode.DiagnosticSeverity.Error);
    expect(diagnostics1[0].message).toMatch(
      /.*Attempt to save an incomplete proof.*/,
    );
    expect(diagnostics1[0].severity).toBe(vscode.DiagnosticSeverity.Error);

    expect(diagnostics2.length).toBe(1);
    expect(diagnostics2[0].message).toMatch(/.*There is no flag or option.*/);
    expect(diagnostics2[0].severity).toBe(vscode.DiagnosticSeverity.Warning);
  });
});
