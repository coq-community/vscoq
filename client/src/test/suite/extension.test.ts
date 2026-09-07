import { expect } from "expect";
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import * as common from "./common";

suite("Should get diagnostics", function () {
    this.timeout(30000);

    teardown(common.resetTestState);

    test("Diagnoses an undefined ref error", async () => {
        const ext = vscode.extensions.getExtension("rocq-prover.vsrocq")!;
        await ext.activate();
        await common.configure("vsrocq.proof.mode", 1);

        const doc = await common.openFixture("basic.v");

        const diagnostics = await common.waitForDiagnostics(
            doc,
            common.anyDiagnostic,
        );

        expect(diagnostics.length).toBe(1);

        const diagnostic = diagnostics[0];

        expect(diagnostic.message).toMatch(/The reference zar was not found.*/);

        expect(diagnostic.severity).toBe(vscode.DiagnosticSeverity.Error);
    });

    test("Opens two files and gets feedback", async () => {
        const ext = vscode.extensions.getExtension("rocq-prover.vsrocq")!;
        await ext.activate();
        await common.configure("vsrocq.proof.mode", 1);

        const doc1 = await common.openFixture("basic.v");
        const doc2 = await common.openFixture("warn.v");

        const [diagnostics1, diagnostics2] = await Promise.all([
            common.waitForDiagnostics(doc1, common.anyDiagnostic),
            common.waitForDiagnostics(doc2, common.anyDiagnostic),
        ]);

        expect(diagnostics1.length).toBe(1);
        expect(diagnostics2.length).toBe(1);
    });
});
