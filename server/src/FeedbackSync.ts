import { Position, Diagnostic } from "vscode-languageserver";
import { Highlights } from "../../lib";

export interface DocumentFeedbackCallbacks {
  sendHighlightUpdates(highlights: Highlights): void;
  sendDiagnostics(diagnostics: Diagnostic[]): void;
  sendStmFocus(focus: Position): void;
}

export class FeedbackSync {
  private focus: Position | null = null;
  private diagnostics: (() => Diagnostic[]) | null = null;
  private highlights: (() => Highlights) | null = null;
  private feedbackTimeout: NodeJS.Timer | null = null;

  public constructor(
    private callbacks: DocumentFeedbackCallbacks,
    private delayMS: number = 500
  ) {}

  private sendFeedbackNow() {
    if (this.focus !== null) this.callbacks.sendStmFocus(this.focus);
    if (this.diagnostics) this.callbacks.sendDiagnostics(this.diagnostics());
    if (this.highlights) this.callbacks.sendHighlightUpdates(this.highlights());
    this.focus = null;
    this.diagnostics = null;
    this.highlights = null;
  }

  private sendFeedbackLazily() {
    if (this.feedbackTimeout !== null) return;
    this.feedbackTimeout = setTimeout(() => {
      this.feedbackTimeout = null;
      this.sendFeedbackNow();
    }, this.delayMS);
  }

  public cancelSync() {
    if (this.feedbackTimeout !== null) clearTimeout(this.feedbackTimeout);
  }

  public syncNow() {
    this.cancelSync();
    this.sendFeedbackNow();
  }

  public updateFocus(focus: Position, now = true) {
    this.focus = focus;
    if (now) this.sendFeedbackNow();
    else this.sendFeedbackLazily();
  }

  public updateHighlights(highlights: () => Highlights, now = true) {
    this.highlights = highlights;
    if (now) this.sendFeedbackNow();
    else this.sendFeedbackLazily();
  }

  public updateDiagnostics(diagnostics: () => Diagnostic[], now = true) {
    this.diagnostics = diagnostics;
    if (now) this.sendFeedbackNow();
    else this.sendFeedbackLazily();
  }
}
