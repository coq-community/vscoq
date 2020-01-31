// The module 'assert' provides assertion methods from node
import * as assert from "assert";
import * as vscode from "vscode-languageserver";

import * as scopes from "../src/sentence-model/Scopes";
import {
  QualId,
  ScopeFlags,
  Symbol,
  SymbolKind
} from "../src/sentence-model/Scopes";

class MockSentence {
  constructor(
    public prev: MockSentence | null,
    public next: MockSentence | null,
    public scope:
      | (scopes.ScopeDeclaration<MockSentence> & IScopeDeclaration)
      | null
  ) {}
  public getScope() {
    return this.scope;
  }
}

class ScopeDeclaration extends scopes.ScopeDeclaration<MockSentence> {}
type SymbolInformation = scopes.SymbolInformation<MockSentence>;

export interface IScopeDeclaration {
  privateSymbols: Symbol[];
  localSymbols: Symbol[];
  exportSymbols: Symbol[];
  lookupSymbolInList(id: QualId, symbols: Symbol[]): SymbolInformation | null;
  lookupHere(id: QualId, flags: ScopeFlags): SymbolInformation | null;
  getPreviousSentence(): ScopeDeclaration | null;
  getNextSentence(): ScopeDeclaration | null;
  getParentScope(): ScopeDeclaration | null;
  resolveSymbol(s: SymbolInformation | null): SymbolInformation | null;
  resolveId(id: QualId, flags: ScopeFlags): SymbolInformation | null;
}

describe("Scopes", function() {
  let currentPos: vscode.Position;

  beforeEach(function() {
    currentPos = vscode.Position.create(0, 0);
  });

  function nextPos(p?: vscode.Position) {
    if (!p) p = currentPos;
    const x = Math.floor(Math.random() * 10);
    const y = Math.floor(Math.random() * 10);
    currentPos = vscode.Position.create(p.line + x, p.character + y);
    return currentPos;
  }

  function nextRange(r?: vscode.Range | vscode.Position) {
    if (!r) r = currentPos;
    const s = nextPos(vscode.Range.is(r) ? r.end : r);
    const e = nextPos(s);
    return vscode.Range.create(s, e);
  }

  // before("check if coqtop exists", function() {
  //   if(!fs.existsSync(path.join(COQBIN_8_6, '/coqtop')) && (os.platform()!=='win32' || !fs.existsSync(path.join(COQBIN_8_6, '/coqtop.exe')))) {
  //     console.warn("Cannot find coqtop: " + path.join(COQBIN_8_6, '/coqtop'));
  //     console.warn("Please make sure you have set env-var COQBIN_8_6 to point to the binaries directory of Coq 8.6.");
  //     this.skip();
  //   }
  // })
  describe("helpers", function() {
    it("resolveQualId", function() {
      assert.deepStrictEqual(scopes.resolveQualId([], []), []);
      assert.deepStrictEqual(scopes.resolveQualId([], ["a"]), null);
      assert.deepStrictEqual(scopes.resolveQualId(["a"], ["a"]), ["a"]);
      assert.deepStrictEqual(scopes.resolveQualId(["a"], ["b", "a"]), null);
      assert.deepStrictEqual(scopes.resolveQualId(["a2"], []), ["a2"]);
      assert.deepStrictEqual(scopes.resolveQualId(["a2", "b"], []), [
        "a2",
        "b"
      ]);
      assert.deepStrictEqual(scopes.resolveQualId(["b", "a"], ["a"]), [
        "b",
        "a"
      ]);
      assert.deepStrictEqual(scopes.resolveQualId(["a", "b"], ["a", "b"]), [
        "a",
        "b"
      ]);
      assert.deepStrictEqual(
        scopes.resolveQualId(["a", "b"], ["a", "c"]),
        null
      );
      assert.deepStrictEqual(scopes.resolveQualId(["a", "b"], ["c"]), null);
    });

    it("matchQualId", function() {
      assert.deepStrictEqual(scopes.matchQualId([], []), {
        which: 0,
        prefix: [],
        id: []
      });
      assert.deepStrictEqual(scopes.matchQualId([], ["a"]), {
        which: 0,
        prefix: ["a"],
        id: []
      });
      assert.deepStrictEqual(scopes.matchQualId(["a"], ["a"]), {
        which: 0,
        prefix: [],
        id: ["a"]
      });
      assert.deepStrictEqual(scopes.matchQualId(["a"], ["b", "a"]), {
        which: 0,
        prefix: ["b"],
        id: ["a"]
      });
      assert.deepStrictEqual(scopes.matchQualId(["a"], []), {
        which: 1,
        prefix: ["a"],
        id: []
      });
      assert.deepStrictEqual(scopes.matchQualId(["b", "a"], ["a"]), {
        which: 1,
        prefix: ["b"],
        id: ["a"]
      });
      assert.deepStrictEqual(scopes.matchQualId(["c", "b", "a"], ["a"]), {
        which: 1,
        prefix: ["c", "b"],
        id: ["a"]
      });
      assert.deepStrictEqual(scopes.matchQualId(["c", "b", "a"], ["b", "a"]), {
        which: 1,
        prefix: ["c"],
        id: ["b", "a"]
      });
      assert.deepStrictEqual(scopes.matchQualId(["a", "b"], ["a", "b"]), {
        which: 0,
        prefix: [],
        id: ["a", "b"]
      });
      assert.deepStrictEqual(scopes.matchQualId(["a", "b"], ["a", "c"]), null);
      assert.deepStrictEqual(scopes.matchQualId(["a", "b"], ["c", "b"]), null);
      assert.deepStrictEqual(scopes.matchQualId(["a", "b"], ["c"]), null);
    });

    it("ScopeFlags", function() {
      assert.equal(ScopeFlags.All & ScopeFlags.Local, ScopeFlags.Local);
      assert.equal(ScopeFlags.All & ScopeFlags.Private, ScopeFlags.Private);
      assert.equal(ScopeFlags.All & ScopeFlags.Export, ScopeFlags.Export);
      assert.equal(ScopeFlags.Local & ScopeFlags.Private, false);
      assert.equal(ScopeFlags.Local & ScopeFlags.Export, false);
      assert.equal(ScopeFlags.Private & ScopeFlags.Export, false);
    });
  });

  describe.skip("single-scope", function() {
    let s: MockSentence;
    let symb;

    beforeEach(function() {
      symb = {
        foo: {
          identifier: "foo",
          range: nextRange(),
          kind: SymbolKind.Definition
        },
        bar: {
          identifier: "bar",
          range: nextRange(),
          kind: SymbolKind.Definition
        },
        aaa: {
          identifier: "aaa",
          range: nextRange(),
          kind: SymbolKind.Definition
        },
        bbb: {
          identifier: "bbb",
          range: nextRange(),
          kind: SymbolKind.Definition
        },
        ccc: {
          identifier: "ccc",
          range: nextRange(),
          kind: SymbolKind.Definition
        }
      };
      s = new MockSentence(null, null, null);
    });

    it("constructor1", function() {
      s.scope = new ScopeDeclaration(s, [], null) as any;
      const sc = (s.scope as any) as IScopeDeclaration;
      assert.equal(s.scope.lookup([], ScopeFlags.All), null);
      assert.equal(s.scope.lookup(["foo"], ScopeFlags.All), null);
      assert.equal(s.scope.lookup(["M", "foo"], ScopeFlags.All), null);
      assert.equal(s.scope.isBegin(), false);
      assert.equal(s.scope.isEnd(), false);
      assert.deepStrictEqual(s.scope.getPrefixes(), []);
      assert.deepStrictEqual(sc.getNextSentence(), null);
      assert.deepStrictEqual(sc.getPreviousSentence(), null);
      assert.deepStrictEqual(sc.getParentScope(), null);
    });

    it("constructor2", function() {
      s.scope = new ScopeDeclaration(s, ["M"], null) as any;
      assert.equal(s.scope.lookup([], ScopeFlags.All), null);
      assert.equal(s.scope.lookup(["foo"], ScopeFlags.All), null);
      assert.equal(s.scope.lookup(["M", "foo"], ScopeFlags.All), null);
      assert.equal(s.scope.isBegin(), false);
      assert.equal(s.scope.isEnd(), false);
      assert.deepStrictEqual(s.scope.getPrefixes(), []);
    });

    it("isBegin", function() {
      s.scope = new ScopeDeclaration(s, ["M"], {
        kind: "begin",
        name: "MOO",
        exports: true
      }) as any;
      assert.equal(s.scope.isBegin("M"), false);
      assert.equal(s.scope.isBegin("MOO"), true);
      assert.equal(s.scope.isEnd("MOO"), false);
      assert.equal(s.scope.isEnd("M"), false);
      assert.equal(s.scope.isEnd(), false);
    });

    it("isEnd", function() {
      s.scope = new ScopeDeclaration(s, ["M"], {
        kind: "end",
        name: "MOO"
      }) as any;
      assert.equal(s.scope.isBegin("M"), false);
      assert.equal(s.scope.isBegin("MOO"), false);
      assert.equal(s.scope.isEnd("MOO"), true);
      assert.equal(s.scope.isEnd("M"), false);
      assert.equal(s.scope.isEnd(), true);
    });

    function assertSymbolLookup(
      si: SymbolInformation[] | null,
      sy: Symbol[],
      p: QualId
    ) {
      assert.notEqual(si, null);
      si.forEach((si, idx) => assert.equal(si.symbol, sy[idx]));
      si.forEach((si, idx) => assert.deepStrictEqual(si.source, s));
      si.forEach((si, idx) =>
        assert.deepStrictEqual(si.id, [...p, sy[idx].identifier])
      );
      si.forEach((si, idx) => assert.deepStrictEqual(si.assumedPrefix, []));
    }

    it("lookupSymbolInList", function() {
      s.scope = new ScopeDeclaration(s, ["M"], null) as any;
      const sc = (s.scope as any) as IScopeDeclaration;
      assertSymbolLookup(
        [sc.lookupSymbolInList(["foo"], [symb.foo])],
        [symb.foo],
        []
      );
      assertSymbolLookup(
        [sc.lookupSymbolInList(["bar"], [symb.foo, symb.bar, symb.aaa])],
        [symb.bar],
        []
      );
      assert.deepStrictEqual(sc.lookupSymbolInList(["bar"], []), null);
    });

    it("lookupHere", function() {
      s.scope = new ScopeDeclaration(s, ["M"], null) as any;
      const sc = (s.scope as any) as IScopeDeclaration;
      s.scope.addExportSymbol(symb.foo);
      assert.equal(sc.lookupHere(["bar"], ScopeFlags.All), null);
      assert.equal(sc.lookupHere(["foo"], ScopeFlags.Local), null);
      assert.equal(sc.lookupHere(["foo"], ScopeFlags.Private), null);
      assertSymbolLookup(
        [sc.lookupHere(["foo"], ScopeFlags.All)],
        [symb.foo],
        []
      );
      assertSymbolLookup(
        [sc.lookupHere(["foo"], ScopeFlags.Export)],
        [symb.foo],
        []
      );
    });

    it("resolveSymbol", function() {
      s.scope = new ScopeDeclaration(s, ["M"], null) as any;
      const sc = (s.scope as any) as IScopeDeclaration;
      assert.equal(sc.resolveSymbol(null), null);
      s.scope.addExportSymbol(symb.foo);
      assert.equal(sc.resolveSymbol(null), null);
      const si1: SymbolInformation = {
        assumedPrefix: [],
        id: ["foo"],
        source: s,
        symbol: symb.foo
      };
      assert.notEqual(sc.resolveSymbol(si1), null);
      assert.deepStrictEqual(sc.resolveSymbol(si1).assumedPrefix, []);
      assert.deepStrictEqual(sc.resolveSymbol(si1).id, ["foo"]);
      assert.equal(sc.resolveSymbol(si1).source, s);
      assert.equal(sc.resolveSymbol(si1).symbol, symb.foo);

      const si2: SymbolInformation = {
        assumedPrefix: ["M0"],
        id: ["foo"],
        source: s,
        symbol: symb.foo
      };
      assert.deepStrictEqual(sc.resolveSymbol(si2), null);

      const si3: SymbolInformation = {
        assumedPrefix: ["M2"],
        id: ["foo"],
        source: s,
        symbol: symb.foo
      };
      assert.deepStrictEqual(sc.resolveSymbol(si3), null);

      s.scope.getPrefixes = function() {
        return [["M1", "M2"]];
      };
      assert.deepStrictEqual(sc.resolveSymbol(si1).assumedPrefix, []);
      assert.deepStrictEqual(sc.resolveSymbol(si1).id, ["M1", "M2", "foo"]);
      assert.deepStrictEqual(sc.resolveSymbol(si2), null);
      assert.notEqual(sc.resolveSymbol(si3), null);
      assert.deepStrictEqual(sc.resolveSymbol(si3).id, ["M1", "M2", "foo"]);
      assert.deepStrictEqual(sc.resolveSymbol(si3).assumedPrefix, []);
    });

    it("lookup", function() {
      s.scope = new ScopeDeclaration(s, ["M"], null) as any;
      s.scope.addExportSymbol(symb.foo);

      assertSymbolLookup(s.scope.lookup(["foo"], ScopeFlags.All), symb.foo, []);
      assert.equal(s.scope.lookup(["bar"], ScopeFlags.All), null);
    });
  });

  describe("multi-scope", function() {
    let s: MockSentence[];

    function addScope(
      create: (s: MockSentence, ...args: any[]) => ScopeDeclaration,
      ...args: any[]
    ) {
      const i = s.push(new MockSentence(null, null, null)) - 1;
      s[i].scope = create(s[i], ...args) as any;
      if (i > 0) {
        s[i - 1].next = s[i];
        s[i].prev = s[i - 1];
      }
    }

    beforeEach(function() {
      s = [];
      addScope(ScopeDeclaration.createDefinition, "foo", nextRange()) as any;
      addScope(ScopeDeclaration.createSection, "A", nextRange()) as any;
      addScope(ScopeDeclaration.createDefinition, "bar", nextRange()) as any;
      addScope(ScopeDeclaration.createEnd, "A") as any;
      addScope(ScopeDeclaration.createModule, "M", nextRange()) as any;
      addScope(ScopeDeclaration.createDefinition, "foo", nextRange()) as any;
      addScope(ScopeDeclaration.createDefinition, "bar", nextRange()) as any;
      addScope(ScopeDeclaration.createEnd, "M") as any;
      addScope(ScopeDeclaration.createDefinition, "bar", nextRange()) as any;
    });

    it("getPreviousSentence", function() {
      const sc0 = (s[0].scope as any) as IScopeDeclaration;
      assert.deepStrictEqual(sc0.getPreviousSentence(), null);
      for (let idx = 1; idx < s.length; ++idx) {
        const sc = (s[idx].scope as any) as IScopeDeclaration;
        assert.deepStrictEqual(sc.getPreviousSentence(), s[idx - 1].scope);
      }
    });

    it("getNextSentence", function() {
      for (let idx = 0; idx < s.length - 1; ++idx) {
        const sc = (s[idx].scope as any) as IScopeDeclaration;
        assert.deepStrictEqual(sc.getNextSentence(), s[idx + 1].scope);
      }
      const sc1 = (s[s.length - 1].scope as any) as IScopeDeclaration;
      assert.deepStrictEqual(sc1.getNextSentence(), null);
    });

    it("getParentScope", function() {
      function testGetParentScope(tests: [number, number][]) {
        tests.forEach(([idx, expected]) =>
          assert.deepStrictEqual(
            (s[idx].scope as IScopeDeclaration).getParentScope(),
            expected === null ? null : s[expected].scope,
            `s[${idx}].getParent() === ${
              expected === null ? "null" : `s[${expected.toString()}].scope`
            }`
          )
        );
      }
      testGetParentScope([
        [0, null],
        [1, null],
        [2, 1],
        [3, 1],
        [4, null],
        [5, 4],
        [6, 4],
        [7, 4],
        [8, null]
      ]);
    });

    it.skip("getPrefix", function() {
      function testGetPrefix(tests: [number, QualId][]) {
        tests.forEach(([idx, expected]) =>
          assert.deepStrictEqual(
            s[idx].scope.getPrefixes(),
            expected,
            `s[${idx}].prefix === ${expected.toString()}`
          )
        );
      }
      testGetPrefix([
        [0, []],
        [1, []],
        [2, []],
        [3, []],
        [4, []],
        [5, ["M"]],
        [6, ["M"]],
        [7, ["M"]],
        [8, []]
      ]);
    });

    it.skip("lookup", function() {
      function testLookup(
        tests: [number, QualId, ScopeFlags, number[], QualId[]][]
      ) {
        tests.forEach(([idx, id, f, expectedSource, expectedId]) => {
          const x = s[idx].scope.lookup(id, f);
          x.forEach((x, idx) => {
            assert.deepStrictEqual(
              x.source,
              s[expectedSource[idx]],
              `s[${idx}].lookup(${id.toString()}).source === s[${expectedSource[
                idx
              ].toString()}]`
            );
            assert.deepStrictEqual(
              x.id,
              expectedId[idx],
              `s[${idx}].lookup(${id.toString()}).id === ${expectedId[
                idx
              ].toString()}`
            );
          });
        });
      }
      testLookup([
        [0, ["foo"], ScopeFlags.All, [0], [["foo"]]],
        [8, ["bar"], ScopeFlags.All, [8], [["bar"]]],
        [8, ["foo"], ScopeFlags.All, [5], [["M", "foo"]]], // bug; should fail
        [8, ["M", "foo"], ScopeFlags.All, [5], [["M", "foo"]]],
        [8, ["foo"], ScopeFlags.All, [0], [["foo"]]] // bug; should succeed
      ]);
    });
  });
});
