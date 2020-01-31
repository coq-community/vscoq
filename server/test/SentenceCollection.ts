// The module 'assert' provides assertion methods from node
import * as assert from "assert";
import * as vscode from "vscode-languageserver";

import { SentenceCollection } from "../src/sentence-model/SentenceCollection";
import { TextDocumentItem } from "../src/document";

interface SentenceCollection_PRIVATE {
  applyChangesToDocumentText(
    changes: vscode.TextDocumentContentChangeEvent[]
  ): void;
}

// Goal True.
// pose (True /\ True/\ True/\ True/\ True/\ True/\ True/\ True/\ True /\ True/\ True/\ True/\ True/\ True/\ True/\ True/\ True).

// class MockDocument {
//   public constructor(
//     public lines: string[],
//     public newLine = '\n',
//     public version = 0,
//     public languageId = 'coq',
//     public uri = 'file:///mock-doc,
//     ) {
//     this.lines = lines.reduce((ls, l) => [...ls, ...l.split(/\n\r|\r\n|\n/)], [] as string[])
//   }

//   public getDocumentItem() : TextDocumentItem {
//     return { uri: this.uri, languageId: this.languageId, text: this.getText(), version: 0, };
//   }

//   public validateRange(range: vscode.Range) : vscode.Range {
//     if(this.lines.length === 0)
//       return vscode.Range.create(0,0,0,0);
//     range = vscode.Range.create(Math.max(0,range.start.line), Math.max(0, range.start.character), Math.max(0, range.end.line), Math.max(0, range.end.character))
//     if(range.end.line < this.lines.length)
//       return vscode.Range.create(range.start.line, range.start.character, range.end.line, Math.min(range.end.character, this.lines[range.end.line].length+this.newLine.length));
//     else
//       return vscode.Range.create(range.start.line, range.start.character, this.lines.length-1, this.lines[this.lines.length-1].length+this.newLine.length);
//   }

//   public getText(range?: vscode.Range) : string {
//     if(range) {
//       range = this.validateRange(range);
//       if(range.start.line === range.end.line)
//         return (this.lines[range.start.line]+this.newLine).substring(range.start.character, range.end.character);
//       else
//         return [
//           (this.lines[range.start.line]+this.newLine).substring(range.start.character),
//           ...this.lines.slice(range.start.line+1, range.end.line),
//           (this.lines[range.end.line]+this.newLine).substring(0, range.end.character)
//           ].join(this.newLine);
//     } else
//       return this.lines.join(this.newLine);
//   }

//   private makeChange(range: vscode.Range, text: string) : vscode.TextDocumentContentChangeEvent;
//   private makeChange(startLine: number, startCharacter: number, endLine: number, endCharacter: number, text: string) : vscode.TextDocumentContentChangeEvent;
//   private makeChange(...args : (vscode.Range|number|string)[]) : vscode.TextDocumentContentChangeEvent {
//     if(typeof args[0] === "number")
//       return this.makeChange(vscode.Range.create(args[0] as number,args[1] as number,args[2] as number,args[3] as number), args[4] as string);
//     else return {
//       range: args[0] as vscode.Range,
//       text: args[1] as string,
//       rangeLength: this.getText(args[0] as vscode.Range).length,
//     }
//   }

//   public moveLines(start: number, count: number, down: number) : vscode.TextDocumentContentChangeEvent[] {
//     if(start+count+down > this.lines.length)
//       down = this.lines.length - start - count;
//     else if(start+down < 0)
//       down = -start;
//     if(count <= 0 || down === 0 || start < 0 || start >= this.lines.length)
//       return [];
//     const changes : vscode.TextDocumentContentChangeEvent[] = [];
//     if(down > 0) {// delete & insert
//       const lastLine = start+count-1;
//       changes.push(this.makeChange(lastLine, this.lines[lastLine].length, lastLine+down, this.lines[lastLine+down].length, ""));
//       const cut = this.lines.splice(start+count, down);
//       changes.push(this.makeChange(start, 0, start, 0, cut.join(this.newLine)));
//       this.lines.splice(start, 0, ...cut);
//     } else {// insert & delete
//       changes.push(this.makeChange(start+count, 0, start+count, 0, )));

//       changes.push(this.makeChange(lastLine, this.lines[lastLine].length, lastLine+down, this.lines[lastLine+down].length, ""));
//       const cut = this.lines.splice(start+count, down);
//       this.lines.splice(start, 0, ...cut);
//     }
//     return changes
//   }
// }

function getText(text: string, range?: vscode.Range): string {
  const lines = text.split(/\r\n|\n\r|\n/);
  const newLines = text.split(/[^\r\n]+/);
  newLines.shift();
  const lineAt = (l: number) => lines[l] + newLines[l];

  if (range.start.line === range.end.line)
    return lineAt(range.start.line).substring(
      range.start.character,
      range.end.character
    );
  else
    return (
      lineAt(range.start.line).substring(range.start.character) +
      lines
        .slice(range.start.line + 1, range.end.line)
        .map((l, idx) => l + newLines[idx + range.start.line + 1])
        .join("") +
      lineAt(range.end.line).substring(0, range.end.character)
    );
}

describe("SentenceCollection", function() {
  function newDoc(text: string | string[]): TextDocumentItem {
    if (text instanceof Array) text = text.join("\n");
    return {
      uri: "file:///doc",
      languageId: "coq",
      text: text,
      version: 0
    };
  }

  function makeChange(
    docText: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
    text: string
  ): vscode.TextDocumentContentChangeEvent {
    const range = vscode.Range.create(
      startLine,
      startCharacter,
      endLine,
      endCharacter
    );
    return {
      range: range,
      text: text,
      rangeLength: getText(docText, range).length
    };
  }

  describe("applyChangesToDocumentText", function() {
    it("1", function() {
      const doc = newDoc("Goal True.\npose True.\n");
      let sc = new SentenceCollection(doc);
      assert.equal(sc.getText(), "Goal True.\npose True.\n");
      ((sc as any) as SentenceCollection_PRIVATE).applyChangesToDocumentText([
        makeChange("Goal True.\npose True.\n", 0, 10, 1, 10, ""),
        makeChange("Goal True.\n", 0, 0, 0, 0, "pose True.\n")
      ]);
      assert.equal(sc.getText(), "pose True.\nGoal True.\n");
    });
  });

  describe("swap lines", function() {
    let doc: TextDocumentItem;
    let sc: SentenceCollection;
    beforeEach(function() {
      doc = newDoc("Goal True.\npose True.\n");
      sc = new SentenceCollection(doc);
      assert.equal(sc.getText(), "Goal True.\npose True.\n");
      assert.deepStrictEqual(
        sc.getSentences().map(s => s.getText()),
        ["Goal True.", "\npose True."]
      );
    });

    it("down - two transactions", function() {
      sc.applyTextChanges(1 + doc.version, [
        makeChange("Goal True.\npose True.\n", 0, 10, 1, 10, "")
      ]);
      assert.equal(sc.getText(), "Goal True.\n");
      assert.deepStrictEqual(
        sc.getSentences().map(s => s.getText()),
        ["Goal True."]
      );
      sc.applyTextChanges(2 + doc.version, [
        makeChange("Goal True.\n", 0, 0, 0, 0, "pose True.\n")
      ]);
      assert.equal(sc.getText(), "pose True.\nGoal True.\n");
      assert.deepStrictEqual(
        sc.getSentences().map(s => s.getText()),
        ["pose True.", "\nGoal True."]
      );
    });

    it("down - one transaction", function() {
      const changes = [
        makeChange("Goal True.\npose True.\n", 0, 10, 1, 10, ""),
        makeChange("Goal True.\n", 0, 0, 0, 0, "pose True.\n")
      ];
      5;
      sc.applyTextChanges(1 + doc.version, changes);
      assert.equal(sc.getText(), "pose True.\nGoal True.\n");
      assert.deepStrictEqual(
        sc.getSentences().map(s => s.getText()),
        ["pose True.", "\nGoal True."]
      );
    });

    it("up - two transactions", function() {
      sc.applyTextChanges(1 + doc.version, [
        makeChange("Goal True.\npose True.\n", 1, 10, 1, 10, "\nGoal True.")
      ]);
      assert.equal(sc.getText(), "Goal True.\npose True.\nGoal True.\n");
      assert.deepStrictEqual(
        sc.getSentences().map(s => s.getText()),
        ["Goal True.", "\npose True.", "\nGoal True."]
      );
      sc.applyTextChanges(2 + doc.version, [
        makeChange("Goal True.\n", 0, 0, 1, 0, "")
      ]);
      assert.equal(sc.getText(), "pose True.\nGoal True.\n");
      assert.deepStrictEqual(
        sc.getSentences().map(s => s.getText()),
        ["pose True.", "\nGoal True."]
      );
    });
  });
});
