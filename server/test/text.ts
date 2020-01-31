// The module 'assert' provides assertion methods from node
import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as text from "../src/util/AnnotatedText";

// Defines a Mocha test suite to group tests of similar kind together
describe("AnnotatedText", () => {
  it("textToString", () => {
    assert.equal(text.textToString("foo"), "foo");
    assert.equal(text.textToString(["foo", "bar"]), "foobar");
    assert.equal(
      text.textToString([{ scope: "aa", text: "foo" }, "bar"]),
      "foobar"
    );
    assert.equal(
      text.textToString([{ scope: "aa", text: ["foo", "!!"] }, "bar"]),
      "foo!!bar"
    );
    assert.equal(
      text.textToString([
        { substitution: "FOO", diff: "added", text: "foo" },
        "bar"
      ]),
      "foobar"
    );
    assert.equal(
      text.textToString([
        { substitution: "∀", text: "forall" },
        " x : nat, x = x ",
        { substitution: "∨", text: "\\/" },
        " ",
        { substitution: "⊥", text: "False" }
      ]),
      "forall x : nat, x = x \\/ False"
    );
    assert.equal(
      text.textToString([
        "0 = 0 ",
        { substitution: "∨", text: "\\/" },
        " ",
        { substitution: "⊥", text: "False" }
      ]),
      "0 = 0 \\/ False"
    );
  });

  it("textToDisplayString", () => {
    assert.equal(text.textToDisplayString("foo"), "foo");
    assert.equal(text.textToDisplayString(["foo", "bar"]), "foobar");
    assert.equal(
      text.textToDisplayString([{ scope: "aa", text: "foo" }, "bar"]),
      "foobar"
    );
    assert.equal(
      text.textToDisplayString([{ scope: "aa", text: ["foo", "!!"] }, "bar"]),
      "foo!!bar"
    );
    assert.equal(
      text.textToDisplayString([
        { substitution: "FOO!!", diff: "added", text: "foo" },
        "bar"
      ]),
      "FOO!!bar"
    );
    assert.equal(
      text.textToDisplayString([
        { substitution: "∀", text: "forall" },
        " x : nat, x = x ",
        { substitution: "∨", text: "\\/" },
        " ",
        { substitution: "⊥", text: "False" }
      ]),
      "∀ x : nat, x = x ∨ ⊥"
    );
    assert.equal(
      text.textToDisplayString([
        "0 = 0 ",
        { substitution: "∨", text: "\\/" },
        " ",
        { substitution: "⊥", text: "False" }
      ]),
      "0 = 0 ∨ ⊥"
    );
    assert.equal(
      text.textToDisplayString([
        {
          scope: "aa",
          text: [{ substitution: "FOO!!", diff: "added", text: "foo" }, "bar"]
        },
        "dee"
      ]),
      "FOO!!bardee"
    );
  });

  it("textLength", () => {
    assert.equal(text.textLength("foo"), 3);
    assert.equal(text.textLength(["foo", "bar"]), 6);
    assert.equal(text.textLength([{ scope: "aa", text: "foo" }, "bar"]), 6);
    assert.equal(
      text.textLength([{ scope: "aa", text: ["foo", "!!"] }, "bar"]),
      8
    );
    assert.equal(
      text.textLength([
        { substitution: "FOO", diff: "added", text: "foo" },
        "bar"
      ]),
      6
    );
  });

  it("textDisplayLength", () => {
    assert.equal(text.textDisplayLength("foo"), 3);
    assert.equal(text.textDisplayLength(["foo", "bar"]), 6);
    assert.equal(
      text.textDisplayLength([{ scope: "aa", text: "foo" }, "bar"]),
      6
    );
    assert.equal(
      text.textDisplayLength([{ scope: "aa", text: ["foo", "!!"] }, "bar"]),
      8
    );
    assert.equal(
      text.textDisplayLength([
        { substitution: "FOO!!", diff: "added", text: "foo" },
        "bar"
      ]),
      8
    );
    assert.equal(
      text.textDisplayLength([
        {
          scope: "aa",
          text: [{ substitution: "FOO!!", diff: "added", text: "foo" }, "bar"]
        },
        "dee"
      ]),
      11
    );
  });

  it("isScopedText", () => {
    assert(!text.isScopedText({ text: "aa", diff: "added" }));
    assert(!text.isScopedText({ text: "bb", diff: "added" }));
  });

  it("isTextAnnotation", () => {
    assert(text.isTextAnnotation({ text: "aa", diff: "added" }));
    assert(text.isTextAnnotation({ text: "bb", diff: "added" }));
  });

  it("compatibleAnnotations", () => {
    assert(
      text.compatibleAnnotations(
        { text: "aa", diff: "added" },
        { text: "bb", diff: "added" }
      )
    );
  });

  it("tryCombineText", () => {
    assert.deepStrictEqual(
      text.tryCombineText(
        { text: "aa", diff: "added" },
        { text: "bb", diff: "added" }
      ),
      { diff: "added", text: "aabb" }
    );
    assert.deepStrictEqual(
      text.tryCombineText({ text: "aa", diff: "added" }, ""),
      { diff: "added", text: "aa" }
    );
    assert.deepStrictEqual(
      text.tryCombineText("", { text: "aa", diff: "added" }),
      { diff: "added", text: "aa" }
    );
  });

  it("normalizeText", () => {
    assert.equal(text.normalizeText("foo"), "foo");
    assert.equal(text.normalizeText(["foo", "bar"]), "foobar");
    assert.equal(text.normalizeText(["foo", "\n", "bar"]), "foo\nbar");
    assert.deepStrictEqual(
      text.normalizeText([{ scope: "aa", text: "foo" }, ""]),
      { scope: "aa", text: "foo" }
    );
    assert.deepStrictEqual(
      text.normalizeText({ scope: "aa", attributes: {}, text: "foo" }),
      { scope: "aa", text: "foo" }
    );
    assert.deepStrictEqual(
      text.normalizeText([{ scope: "aa", text: "foo" }, "bar"]),
      [{ scope: "aa", text: "foo" }, "bar"]
    );
    assert.deepStrictEqual(
      text.normalizeText([{ scope: "aa", text: ["foo", "!!"] }, "bar"]),
      [{ scope: "aa", text: "foo!!" }, "bar"]
    );
    assert.deepStrictEqual(
      text.normalizeText([
        { substitution: "FOO!!", diff: "added", text: "foo" },
        "bar"
      ]),
      [{ substitution: "FOO!!", diff: "added", text: "foo" }, "bar"]
    );
    assert.deepStrictEqual(
      text.normalizeText([
        { scope: "aa", text: ["foo", "!!"] },
        { scope: "aa", text: ["bar"] }
      ]),
      { scope: "aa", text: "foo!!bar" }
    );
    assert.deepStrictEqual(
      text.normalizeText([
        { scope: "aa", text: ["foo", "!!"] },
        "\n",
        { scope: "aa", text: ["bar"] }
      ]),
      [{ scope: "aa", text: "foo!!" }, "\n", { scope: "aa", text: "bar" }]
    );
    assert.deepStrictEqual(
      text.normalizeText([
        { scope: "aa", text: { scope: "", text: ["foo", "!!"] } },
        "bar"
      ]),
      [{ scope: "aa", text: "foo!!" }, "bar"]
    );
    assert.deepStrictEqual(
      text.normalizeText([
        { scope: "aa", text: { scope: "", text: ["foo", "!!"] } },
        { scope: "aa", text: ["bar"] }
      ]),
      { scope: "aa", text: "foo!!bar" }
    );
    assert.deepStrictEqual(
      text.normalizeText({ diff: "added", text: "aabbaa" }),
      { diff: "added", text: "aabbaa" }
    );
    assert.deepStrictEqual(
      text.normalizeText([
        { text: "aa", diff: "added" },
        { text: "bb", diff: "added" },
        { text: "aa", diff: "added" }
      ]),
      { diff: "added", text: "aabbaa" }
    );

    function notation(
      s: text.AnnotatedText
    ): string | text.TextAnnotation | text.ScopedText {
      return { scope: "constr.notation", text: s };
    }
    function variable(
      s: text.AnnotatedText
    ): string | text.TextAnnotation | text.ScopedText {
      return { scope: "constr.variable", text: s };
    }
    const x1 = [notation("["), variable("d")];
    assert.deepStrictEqual(text.normalizeText(x1), x1);
    const x2 = [
      notation("["),
      variable("d"),
      notation("]"),
      " ",
      notation("="),
      " ",
      notation("[]")
    ];
    assert.deepStrictEqual(text.normalizeText(x2), x2);
  });

  it("textSplit", () => {
    assert.deepStrictEqual(text.textSplit("foo bar", " "), {
      splits: ["foo", "bar"],
      rest: []
    });
    assert.deepStrictEqual(text.textSplit("foo  bar", " "), {
      splits: ["foo", "bar"],
      rest: []
    });
    assert.deepStrictEqual(text.textSplit(["foo  bar", " dee  doo "], " "), {
      splits: ["foo", "bar", "dee", "doo"],
      rest: []
    });
    assert.deepStrictEqual(
      text.textSplit([{ scope: "aa", text: "foo" }, " bar"], " "),
      { splits: [{ scope: "aa", text: "foo" }, "bar"], rest: [] }
    );
    assert.deepStrictEqual(
      text.textSplit([{ scope: "aa", text: "foo buh " }, " bar"], " "),
      {
        splits: [
          { scope: "aa", text: "foo" },
          { scope: "aa", text: "buh" },
          "bar"
        ],
        rest: []
      }
    );
    assert.deepStrictEqual(text.textSplit("H1 : nat := 1=1", /(:=|:)([^]*)/), {
      splits: ["H1 ", ":", " nat := 1=1"],
      rest: []
    });
    assert.deepStrictEqual(
      text.textSplit(
        ["H1 ", { diff: "added", text: ": nat := 1=1" }],
        /(:=|:)([^]*)/
      ),
      {
        splits: [
          "H1 ",
          { diff: "added", text: ":" },
          { diff: "added", text: " nat := 1=1" }
        ],
        rest: []
      }
    );
    assert.deepStrictEqual(
      text.textSplit(
        ["H1 ", { diff: "added", text: ": nat := 1=1" }],
        /(:=|:)([^]*)/,
        2
      ),
      {
        splits: ["H1 ", { diff: "added", text: ":" }],
        rest: [{ diff: "added", text: " nat := 1=1" }]
      }
    );
    assert.deepStrictEqual(
      text.textSplit(
        ["H1 ", { diff: "added", text: ": nat := 1=1" }],
        /(:=|:)([^]*)/,
        3
      ),
      {
        splits: [
          "H1 ",
          { diff: "added", text: ":" },
          { diff: "added", text: " nat := 1=1" }
        ],
        rest: []
      }
    );
  });

  it("mapAnnotation", () => {
    let hist: [string, text.Annotation, number, number][] = [];
    let x: text.AnnotatedText = "foo";
    assert.deepStrictEqual(
      text.mapAnnotation(x, (plainText, annotation, start, startD) => {
        hist.push([plainText, annotation, start, startD]);
        return Object.assign(text.copyAnnotation(annotation), {
          text: plainText
        });
      }),
      { text: "foo" }
    );
    assert.deepStrictEqual(hist, [["foo", {}, 0, 0]]);
    //////
    hist = [];
    x = [{ substitution: "bar!!", text: "foo" }, "def"];
    assert.deepStrictEqual(
      text.mapAnnotation(x, (plainText, annotation, start, startD) => {
        hist.push([plainText, annotation, start, startD]);
        return Object.assign(text.copyAnnotation(annotation), {
          text: plainText
        });
      }),
      [{ substitution: "bar!!", text: "foo" }, { text: "def" }]
    );
    assert.deepStrictEqual(hist, [
      ["foo", { substitution: "bar!!" }, 0, 0],
      ["def", {}, 3, 5]
    ]);
  });

  it("diffText", () => {
    assert.deepStrictEqual(text.diffText("aaaa", "aabbaa").text, {
      diff: "added",
      text: "aabbaa"
    });
    assert.deepStrictEqual(text.diffText("aa aa", "aa bb aa").text, [
      "aa ",
      { diff: "added", text: "bb " },
      "aa"
    ]);
    assert.deepStrictEqual(text.diffText("aa bb aa", "aa aa", false).text, [
      "aa ",
      "aa"
    ]);
    assert.deepStrictEqual(text.diffText("aa bb aa", "aa aa").text, "aa aa");
    assert.deepStrictEqual(
      text.diffText(["aa", "aa"], ["aa", "bb", "aa"], false).text,
      [
        { diff: "added", text: "aa" },
        { diff: "added", text: "bb" },
        { diff: "added", text: "aa" }
      ]
    );
    assert.deepStrictEqual(
      text.diffText(["aa", "aa"], ["aa", "bb", "aa"]).text,
      { diff: "added", text: "aabbaa" }
    );
    assert.deepStrictEqual(
      text.diffText(
        { scope: "foo", text: "aa bb aa" },
        { scope: "bar", text: "aa aa" },
        false
      ).text,
      { scope: "bar", text: ["aa ", "aa"] }
    );
    assert.deepStrictEqual(
      text.diffText(
        { scope: "foo", text: "aa bb aa" },
        { scope: "bar", text: "aa aa" }
      ).text,
      { scope: "bar", text: "aa aa" }
    );
    assert.deepStrictEqual(
      text.diffText(
        { diff: "added", text: "aa bb aa" },
        { scope: "bar", text: "aa aa" },
        false
      ).text,
      { scope: "bar", text: ["aa ", "aa"] }
    );
    assert.deepStrictEqual(
      text.diffText(
        { diff: "added", text: "aa bb aa" },
        { scope: "bar", text: "aa aa" }
      ).text,
      { scope: "bar", text: "aa aa" }
    );
    assert.deepStrictEqual(
      text.diffText("aa bb aa", { scope: "bar", text: "aa aa" }, false).text,
      { scope: "bar", text: ["aa ", "aa"] }
    );
    assert.deepStrictEqual(
      text.diffText("aa bb aa", { scope: "bar", text: "aa aa" }).text,
      { scope: "bar", text: "aa aa" }
    );
    assert.deepStrictEqual(
      text.diffText(
        { substitution: "AA", text: "aa" },
        { substitution: "BBB", text: "aa" }
      ).text,
      { diff: "added", substitution: "BBB", text: "aa" }
    );
    assert.deepStrictEqual(
      text.diffText(
        { substitution: "AA AA", text: "aa aa" },
        { substitution: "AA BB AA", text: "aa bb aa" }
      ).text,
      [
        { substitution: "AA ", text: "aa bb aa" },
        { diff: "added", substitution: "BB ", text: "" },
        { substitution: "AA", text: "" }
      ]
    );
    assert.deepStrictEqual(
      text.diffText(
        [
          { substitution: "AA", text: "aa" },
          { substitution: "AA", text: "aa" }
        ],
        [
          { substitution: "AA", text: "aa" },
          { substitution: "BB", text: "bb" },
          { substitution: "AA", text: "aa" }
        ]
      ).text,
      [
        { diff: "added", substitution: "AA", text: "aa" },
        { diff: "added", substitution: "BB", text: "bb" },
        { diff: "added", substitution: "AA", text: "aa" }
      ]
    );
    /////
    let x = [
      { substitution: "∀", text: "forall" },
      " x : nat, x = x ",
      { substitution: "∨", text: "\\/" },
      " ",
      { substitution: "⊥", text: "False" }
    ]; // "∀ x : nat, x = x ∨ ⊥"
    let y = [
      "0 = 0 ",
      { substitution: "∨", text: "\\/" },
      " ",
      { substitution: "⊥", text: "False" }
    ]; // "0 = 0 \\/ False" ~~ "0 = 0 ∨ ⊥"
    // "[∀]<0> [x : nat, x ]= [x]<0> ∨ ⊥"  --> "<0> = <0> ∨ ⊥"
    assert.deepStrictEqual(text.diffText(x, y).text, [
      { diff: "added", text: "0" },
      " = ",
      { diff: "added", text: "0" },
      " ",
      { substitution: "∨", text: "\\/" },
      " ",
      { substitution: "⊥", text: "False" }
    ]);
  });

  it("subtext", function() {
    assert.deepStrictEqual(text.subtext("abcdefghij", 0), "abcdefghij");
    assert.deepStrictEqual(text.subtext("abcdefghij", 5), "fghij");
    assert.deepStrictEqual(text.subtext("abcdefghij", 3, 8), "defgh");
    assert.deepStrictEqual(
      text.subtext(["a", "bcd", "ef", "ghij"], 3),
      "defghij"
    );
    assert.deepStrictEqual(
      text.subtext(["a", "bcd", "ef", "ghij"], 3, 8),
      "defgh"
    );
    assert.deepStrictEqual(
      text.subtext({ scope: "foo", text: "aa bb aa" }, 3, 5),
      { scope: "foo", text: "bb" }
    );
    assert.deepStrictEqual(
      text.subtext(
        [
          { scope: "a", text: "aa" },
          { scope: "b", text: "bb" }
        ],
        1,
        3
      ),
      [
        { scope: "a", text: "a" },
        { scope: "b", text: "b" }
      ]
    );
  });
});
