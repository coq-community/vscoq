import * as vscode from 'vscode';
import { Command } from 'vscode';

const QUICKFIX_REPLACE = 'quickfix-replace';
export const QUICKFIX_COMMAND = 'vscoq.quickfix';

export class QuickFixDiagnostic extends vscode.Diagnostic {
    readonly data?: any[];
}

/**
 * Provides code actions corresponding to diagnostic problems.
 */
export class CoqWarningQuickFix implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
		// for each diagnostic entry that has the matching `code`, create a code action command
		return context.diagnostics
			.filter(diagnostic => diagnostic.code === QUICKFIX_REPLACE)
			.flatMap(diagnostic => this.createCommandCodeAction(diagnostic, document));
	}

	private createCommandCodeAction(diagnostic: QuickFixDiagnostic, document: vscode.TextDocument): vscode.CodeAction[] {
        if(diagnostic.data) {
            
            return diagnostic.data.map(d => {
                const action = new vscode.CodeAction(d.text, vscode.CodeActionKind.QuickFix);
                const data = {
                    ...d, 
                    document: document
                };
                action.command = { command: QUICKFIX_COMMAND, title: 'Replace', tooltip: 'Replace with the suggested change', arguments: [data] };
                return action;
            });
        }
        return [];
		/* action.command = { command: QUICKFIX_COMMAND, title: 'Replace', tooltip: 'Replace with the suggested change' };
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		return action; */
	}
}