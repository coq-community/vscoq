import {
  CancellationToken,
  Event,
  EventEmitter,
  TextDocumentContentProvider,
  Uri,
} from "vscode";
import { RequestType, TextDocumentIdentifier } from "vscode-languageclient";

import { DocumentStateRequest, DocumentStateResponse } from "../protocol/types";

import Client from "../client";

export class DocumentStateViewProvider implements TextDocumentContentProvider {
  readonly scheme = "vscoq-document-state";
  readonly uri = Uri.parse(this.scheme + "://doc");

  private textDocument: TextDocumentIdentifier | null = null;
  readonly eventEmitter = new EventEmitter<Uri>();

  constructor(private _client: Client) {}

  fire(): void {
    if (this.uri !== null) {
      Client.writeToVscoq2Channel("[DocumentStateViewProvider] Firing event");
      Client.writeToVscoq2Channel(
        "[DocumentStateViewProvider] Current doc uri: " +
          this.textDocument?.uri.toString(),
      );
      this.eventEmitter.fire(this.uri);
    }
  }

  get onDidChange(): Event<Uri> {
    return this.eventEmitter.event;
  }

  setDocumentUri(uri: Uri) {
    this.textDocument = TextDocumentIdentifier.create(uri.toString());
  }

  async provideTextDocumentContent(
    uri: Uri,
    token: CancellationToken,
  ): Promise<string> {
    if (this.textDocument === null) {
      Client.writeToVscoq2Channel(
        "[DocumentStateViewProvider] No document was set so no state can be returned !",
      );
      return Promise.reject();
    }

    const params: DocumentStateRequest = {
      textDocument: this.textDocument,
    };
    const req = new RequestType<
      DocumentStateRequest,
      DocumentStateResponse,
      void
    >("vscoq/documentState");
    Client.writeToVscoq2Channel(
      "[DocumentStateViewProvider] Getting document state for uri: " +
        this.textDocument.uri.toString(),
    );
    return this._client
      .sendRequest(req, params)
      .then((result: DocumentStateResponse) => {
        return result.document;
      });
  }
}
