'use strict';


import * as vscode from 'vscode';
import * as proto from './protocol';
import {decorations} from './Decorations';

import { TextEditor } from 'vscode';

function toRange(range: {start: {line: number, character: number}, end: {line: number, character: number}}) {
  return new vscode.Range(range.start.line,range.start.character,range.end.line,range.end.character);
}
export class Highlights {

  private stateErrorRange: vscode.Range[];
  private parsingRange: vscode.Range[];
  private processingRange: vscode.Range[];
  private incompleteRange: vscode.Range[];
  private axiomRange: vscode.Range[];
  private processedRange: vscode.Range[];

  constructor() {
  }

  public set(editors: Iterable<TextEditor>, highlights: proto.Highlights) {
    this.stateErrorRange = highlights.stateErrorRange.map(toRange);
    this.parsingRange = highlights.parsingRange.map(toRange);
    this.processingRange = highlights.processingRange.map(toRange);
    this.incompleteRange = highlights.incompleteRange.map(toRange);
    this.axiomRange = highlights.axiomRange.map(toRange);
    this.processedRange = highlights.processedRange.map(toRange);
    this.applyCurrent(editors);
  }

  public clearAll(editors: Iterable<TextEditor>) {
    this.stateErrorRange = [];
    this.parsingRange = [];
    this.processingRange = [];
    this.incompleteRange = [];
    this.axiomRange = [];
    this.processedRange = [];
    this.applyCurrent(editors);
  }

  public refresh(editors: Iterable<TextEditor>) {
    this.applyCurrent(editors);
  }

  private applyCurrent(editors: Iterable<TextEditor>) {
    for(let editor of editors) {
      editor.setDecorations(decorations.stateError , this.stateErrorRange);
      editor.setDecorations(decorations.parsing    , this.parsingRange);
      editor.setDecorations(decorations.processing , this.processingRange);
      editor.setDecorations(decorations.incomplete , this.incompleteRange);
      editor.setDecorations(decorations.axiom      , this.axiomRange);
      editor.setDecorations(decorations.processed  , this.processedRange);
    }
  }


}