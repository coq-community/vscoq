import * as vscode from 'vscode';
import { LanguageClient } from "vscode-languageclient/node";

export function sendConfiguration(context: vscode.ExtensionContext, client: LanguageClient) {
    const config = vscode.workspace.getConfiguration('vscoq.proof');
    client.sendNotification("vscoq/configuration", {delegation: config.delegation, workers: config.workers});
};


export function updateServerOnConfigurationChange(event: vscode.ConfigurationChangeEvent, context: vscode.ExtensionContext, client: LanguageClient) {
    if(event.affectsConfiguration('vscoq.proof')) {
        sendConfiguration(context, client);
    }
};