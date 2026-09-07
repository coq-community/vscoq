import * as path from "node:path";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

const fixtureRoot = path.resolve(__dirname, "../../../testFixture");

let copiesMade = 0;
const copies: vscode.Uri[] = [];
const settingsChanged = new Set<string>();

/**
 * Copies a fixture to a URI of its own and opens that copy.
 *
 * Every test shares one VS Code instance and one server, and diagnostics are
 * keyed by URI. The server does not retract them when a document is closed
 * (`lspManager.ml`'s `textDocumentDidClose` emits no events), so a test that
 * opens the same fixture as an earlier one reads the earlier one's results and
 * cannot tell them from its own. Opening a fresh copy is what makes a test
 * observe only what it caused.
 *
 * The copies live in the fixture directory, so they are checked under the same
 * workspace root as the originals, and `resetTestState` deletes them.
 */
export async function openFixture(fixture: string): Promise<vscode.Uri> {
    const { name, ext } = path.parse(fixture);
    const copy = vscode.Uri.file(
        path.join(fixtureRoot, `${name}_${copiesMade++}${ext}`),
    );
    await vscode.workspace.fs.copy(
        vscode.Uri.file(path.join(fixtureRoot, fixture)),
        copy,
        { overwrite: true },
    );
    copies.push(copy);

    const doc = await vscode.workspace.openTextDocument(copy);
    await vscode.window.showTextDocument(doc, { preview: false });
    return copy;
}

/**
 * Applies a setting and records it, so that `resetTestState` can take it back
 * out. `update` is asynchronous, so an unawaited call leaves a fixture free to
 * be opened and checked under the previous configuration.
 */
export async function configure(
    section: string,
    value: unknown,
): Promise<void> {
    settingsChanged.add(section);
    await vscode.workspace.getConfiguration().update(section, value);
}

/**
 * Undoes everything a test did to the shared VS Code instance: open editors,
 * fixture copies, and settings. Settings are written to the workspace, i.e.
 * to `testFixture/.vscode/settings.json`, so without this they outlive the
 * whole run and the next one starts from them.
 */
export async function resetTestState(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    for (const copy of copies.splice(0)) {
        await vscode.workspace.fs.delete(copy);
    }

    for (const section of settingsChanged) {
        await vscode.workspace.getConfiguration().update(section, undefined);
    }
    settingsChanged.clear();
}

/**
 * Waits until the diagnostics published for `uri` satisfy `predicate`, and
 * returns them. Rejects after `timeoutMs` instead of continuing with whatever
 * happens to be there.
 *
 * The wait condition and the assertion must be two different statements. The
 * wait is only a synchronisation point — "the server has said something about
 * this document" — and the assertion is what the test is actually about
 * (count, severity, message). A predicate that repeats the assertion makes the
 * test vacuous, since it can only be reached by already being true.
 *
 * A known limitation is that this cannot establish the *absence* of
 * diagnostics. An empty array is also the state before the server has
 * published anything, so `(d) => d.length === 0` holds from the first instant
 * and asserts nothing. Distinguishing "checked, no errors" from "not checked
 * yet" needs the progress ranges carried by `prover/updateHighlights`, which
 * the extension consumes for its decorations and does not expose through the
 * `vscode` API.
 */
export function waitForDiagnostics(
    uri: vscode.Uri,
    predicate: (diagnostics: readonly vscode.Diagnostic[]) => boolean,
    timeoutMs = 10000,
): Promise<readonly vscode.Diagnostic[]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            subscription.dispose();
            reject(
                new Error(
                    `Timed out after ${timeoutMs}ms waiting on diagnostics for ` +
                        `${path.basename(uri.fsPath)}; last seen: ` +
                        `${JSON.stringify(vscode.languages.getDiagnostics(uri))}`,
                ),
            );
        }, timeoutMs);

        const check = () => {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            if (!predicate(diagnostics)) {
                return;
            }
            clearTimeout(timer);
            subscription.dispose();
            resolve(diagnostics);
        };

        const subscription = vscode.languages.onDidChangeDiagnostics((e) => {
            if (
                e.uris.some((changed) => changed.toString() === uri.toString())
            ) {
                check();
            }
        });

        // The document may already be checked by the time we subscribe.
        check();
    });
}

/**
 * At least one diagnostic has been published.
 *
 * Only sound as a wait condition for a fixture whose diagnostics can all come
 * from the same sentence. The server publishes the diagnostics of the whole
 * document after every executed sentence, so for a fixture that fails in more
 * than one place this predicate is satisfied by a mid-check reading and the
 * test goes on to assert against a partial document. Use `diagnosticOnLine`
 * there instead.
 */
export function anyDiagnostic(
    diagnostics: readonly vscode.Diagnostic[],
): boolean {
    return diagnostics.length > 0;
}

/**
 * At least one diagnostic starts on `line` (zero-based).
 *
 * Point this at the last sentence of the fixture to get a terminal condition:
 * a diagnostic reported there means checking has reached the end of the
 * document, so the reading that follows is the final one rather than one of
 * the intermediate publications.
 *
 * This stays a synchronisation point and not the assertion: it fixes *where*
 * the server must have spoken, while the test still asserts *what* it said.
 */
export function diagnosticOnLine(
    line: number,
): (diagnostics: readonly vscode.Diagnostic[]) => boolean {
    return (diagnostics) =>
        diagnostics.some((d) => d.range.start.line === line);
}
