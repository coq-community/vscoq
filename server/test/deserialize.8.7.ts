// The module 'assert' provides assertion methods from node
import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as text from "../src/util/AnnotatedText";
import { CoqProto as proto } from "../../lib";
import * as db from "../src/coqtop/xml-protocol/deserialize.base";
import * as d from "../src/coqtop/xml-protocol/deserialize.8.7";
import * as p from "../src/coqtop/xml-protocol/coq-xml";
import * as stream from "stream";

// Defines a Mocha test suite to group tests of similar kind together
describe("Deserialize 8.7", () => {
  let data: stream.PassThrough;
  let deserializer: db.Deserialize;
  let parser: p.XmlStream;

  beforeEach("init", function() {
    data = new stream.PassThrough();
    deserializer = new d.Deserialize_8_7();
    parser = new p.XmlStream(data, deserializer);
  });

  function parse(xml: string | string[]): Promise<proto.ReturnValue[]> {
    return new Promise<proto.ReturnValue[]>((resolve, reject) => {
      const results: proto.ReturnValue[] = [];
      parser.on("response", (tag, v) => results.push(v));
      parser.on("error", reject);
      parser.on("end", () => resolve(results));
      if (xml instanceof Array) xml.forEach(x => data.emit("data", x));
      else data.emit("data", xml);
      data.emit("end", "");
    });
  }

  it("message", async function() {
    const results = await parse([
      '<message><message_level val="error"/><loc start="1" stop="3"/><string>hi</string></message>'
    ]);
    assert.deepStrictEqual(results, [
      {
        level: proto.MessageLevel.Error,
        location: { start: 1, stop: 3 },
        message: "hi"
      }
    ]);
  });

  it("richpp", async function() {
    function richpp(
      s: text.AnnotatedText
    ): string | text.TextAnnotation | text.ScopedText {
      return { scope: "_", text: s };
    }
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
    const results = await parse(
      `
      <message><message_level val="error"/><loc start="1" stop="3"/><richpp>
      <_>
        <constr.notation>[</constr.notation>
        <constr.variable>d</constr.variable>
        <constr.notation>]</constr.notation>&nbsp;
        <constr.notation>=</constr.notation>&nbsp;
        <constr.notation>[</constr.notation>
        <constr.notation>]</constr.notation>
      </_>
      </richpp></message>`
        .replace(/>\s*</g, "><")
        .replace(/\s*&nbsp;\s*/g, "&nbsp;")
    );
    const x = text.normalizeText((results[0] as proto.Message).message);
    assert.deepStrictEqual(
      x,
      richpp([
        notation("["),
        variable("d"),
        notation("]"),
        `\u00a0`,
        notation("="),
        `\u00a0`,
        notation("[]")
      ])
    );
  });

  describe("LtacProf", () => {
    function ltacprof_tactic(
      name,
      total,
      self,
      num_calls,
      max_total,
      children: string[]
    ) {
      return `<ltacprof_tactic name="${name.toString()}" total="${total.toString()}" local="${self.toString()}" ncalls="${num_calls.toString()}" max_total="${max_total.toString()}">${children.join(
        ""
      )}</ltacprof_tactic>`;
    }

    it("ltacprof_tactic", async function() {
      const results = await parse([
        ltacprof_tactic("abc", 0, 0, 0, 0, []),
        ltacprof_tactic("foo", 4.4, 3.3, 2, 1.1, []),
        ltacprof_tactic("aaa", 4.4, 3.3, 2, 1.1, [
          ltacprof_tactic("bbb", 0, 0, 0, 0, []),
          ltacprof_tactic("ccc", 0, 0, 0, 0, [])
        ])
      ]);
      assert.deepStrictEqual(results[0], {
        name: "abc",
        statistics: { total: 0, local: 0, num_calls: 0, max_total: 0 },
        tactics: []
      });
      assert.deepStrictEqual(results[1], {
        name: "foo",
        statistics: { total: 4.4, local: 3.3, num_calls: 2, max_total: 1.1 },
        tactics: []
      });
      assert.deepStrictEqual(results[2], {
        name: "aaa",
        statistics: { total: 4.4, local: 3.3, num_calls: 2, max_total: 1.1 },
        tactics: [
          {
            name: "bbb",
            statistics: { total: 0, local: 0, num_calls: 0, max_total: 0 },
            tactics: []
          },
          {
            name: "ccc",
            statistics: { total: 0, local: 0, num_calls: 0, max_total: 0 },
            tactics: []
          }
        ]
      });
    });

    it("ltacprof", async function() {
      const results = await parse(
        `<ltacprof total_time="10.1">${ltacprof_tactic(
          "abc",
          0,
          0,
          0,
          0,
          []
        )}${ltacprof_tactic("foo", 1, 2, 3, 4, [])}</ltacprof>`
      );
      assert.deepStrictEqual(results, [
        {
          total_time: 10.1,
          tactics: [
            {
              name: "abc",
              statistics: { total: 0, local: 0, num_calls: 0, max_total: 0 },
              tactics: []
            },
            {
              name: "foo",
              statistics: { total: 1, local: 2, num_calls: 3, max_total: 4 },
              tactics: []
            }
          ]
        }
      ]);
    });

    it("feedback_content - ltacprof", async function() {
      const results = await parse(
        `<feedback_content val="custom"><option val="none"/><string>ltacprof_results</string><ltacprof total_time="10.1">${ltacprof_tactic(
          "abc",
          0,
          0,
          0,
          0,
          []
        )}${ltacprof_tactic(
          "foo",
          1,
          2,
          3,
          4,
          []
        )}</ltacprof></feedback_content>`
      );
      assert.deepStrictEqual(results, [
        {
          feedbackKind: "ltacprof",
          total_time: 10.1,
          tactics: [
            {
              name: "abc",
              statistics: { total: 0, local: 0, num_calls: 0, max_total: 0 },
              tactics: []
            },
            {
              name: "foo",
              statistics: { total: 1, local: 2, num_calls: 3, max_total: 4 },
              tactics: []
            }
          ]
        }
      ]);
    });
  });
});
