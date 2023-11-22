import * as vscode from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  integer
} from 'vscode-languageclient/node';

import {decorationsManual, decorationsContinuous, decorationsSemiContinuous} from './Decorations';

export default class Client extends LanguageClient {

	private static _channel: any = vscode.window.createOutputChannel('VsCoq');
    private _decorations: Map<String, vscode.Range[]> = new Map<String, vscode.Range[]>();

	constructor(
        serverOptions: ServerOptions,
        clientOptions: LanguageClientOptions,
	) {
        super(
		    'vscoq-language-server',
		    'Coq Language Server',
		    serverOptions,
		    clientOptions
        );
		Client._channel.appendLine("VsCoq initialised");
	}

    dispose(): void {
        Client._channel.dispose();
    };

    public static writeToVscoq2Channel(message: string) {
        Client._channel.appendLine(message);
    }

    public saveHighlights(uri: String, processingRange: vscode.Range[], processedRange: vscode.Range[]) {
        this._decorations.set(uri, processedRange);
    }

    public updateHightlights() {
        for(let entry of this._decorations.entries()) {
            this.updateDocumentEditors(entry[0], entry[1]);
        }
    };

    public resetHighlights() {
        for(let entry of this._decorations.entries()) {
            this.resetDocumentEditors(entry[0]);
        }
    }

    private getDocumentEditors(uri: String) {
        return vscode.window.visibleTextEditors.filter(editor => {
            return editor.document.uri.toString() === uri;
        });
    }

    private resetDocumentEditors(uri: String) {
        const editors = this.getDocumentEditors(uri);
        editors.map(editor => {
            editor.setDecorations(decorationsManual.processed, []);
            editor.setDecorations(decorationsContinuous.processed, []);
            editor.setDecorations(decorationsSemiContinuous.processed, []);
        });
    }

    private updateDocumentEditors(uri: String, ranges: vscode.Range[]) {
        const config = vscode.workspace.getConfiguration('vscoq.proof');
        const editors = this.getDocumentEditors(uri);
        editors.map(editor => {
            if(config.mode === 0) {
                editor.setDecorations(decorationsManual.processed, ranges);
            } else if (config.mode === 1) {
                editor.setDecorations(decorationsContinuous.processed, ranges);
            } else {
                editor.setDecorations(decorationsSemiContinuous.processed, ranges);
            }
        });
    }

}
