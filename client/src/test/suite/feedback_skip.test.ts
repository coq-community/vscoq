import { expect } from "expect";
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import * as common from "./common";

/** Zero-based line of `Qed.`, the last sentence of delegate_proof.v. */
const QED_LINE = 5;

suite("Should get diagnostics in the appropriate tab", function () {
    this.timeout(20000);

    teardown(common.resetTestState);

    test("Skipping proofs", async () => {
        const ext = vscode.extensions.getExtension("rocq-prover.vsrocq")!;
        await ext.activate();

        await common.configure("vsrocq.proof.delegation", "Skip");
        await common.configure("vsrocq.proof.mode", 1);

        const doc1 = await common.openFixture("delegate_proof.v");

        const doc2 = await common.openFixture("warn.v");

        const [diagnostics1, diagnostics2] = await Promise.all([
            // delegate_proof.v fails twice under a mode that checks the proof
            // body, so wait on the Qed rather than on the first publication.
            common.waitForDiagnostics(doc1, common.diagnosticOnLine(QED_LINE)),
            common.waitForDiagnostics(doc2, common.anyDiagnostic),
        ]);

        expect(diagnostics1[0].message).toMatch(
            /.*Attempt to save an incomplete proof.*/,
        );
        expect(diagnostics1[0].severity).toBe(vscode.DiagnosticSeverity.Error);

        expect(diagnostics2.length).toBe(1);
        expect(diagnostics2[0].message).toMatch(
            /.*There is no flag or option.*/,
        );
        expect(diagnostics2[0].severity).toBe(
            vscode.DiagnosticSeverity.Warning,
        );
    });
});
