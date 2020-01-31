// The module 'assert' provides assertion methods from node
import * as assert from "assert";

import { CoqProject } from "../src/CoqProject";

interface ICoqProject {
  parseCoqProject(text: string): string[];
}

describe("CoqProject", function() {
  function assertArgs(x, y) {
    const v = ((CoqProject as any) as ICoqProject).parseCoqProject(x);
    assert.deepStrictEqual(v, y, `args("${x}") === ${v}; expected ${y}`);
  }

  it("parseCoqProject - filter out args", function() {
    assertArgs("-byte", []);
    assertArgs("test.v", []);
    assertArgs("test.ml", []);
    assertArgs("test.mli", []);
    assertArgs("test.ml4", []);
    assertArgs("-opt", []);
    assertArgs("-extra x y z ", []);
    assertArgs("-extra-phony x y z ", []);
    assertArgs("-install opt", []);
    assertArgs("-f file", []);
    assertArgs("-o file", []);
    assertArgs("-h", []);
    assertArgs("--help", []);
  });

  it("parseCoqProject - keep args", function() {
    assertArgs("-arg opt", ["opt"]);
    assertArgs('-arg "-foo opt"', ["-foo", "opt"]);
    assertArgs("-R aaa bbb", ["-R", "aaa", "bbb"]);
    assertArgs("-Q aaa bbb", ["-Q", "aaa", "bbb"]);
    assertArgs("-I aaa", ["-I", "aaa"]);
    assertArgs('-arg "foo -bar doo"', ["foo", "-bar", "doo"]);
  });

  it("parseCoqProject - mix", function() {
    assertArgs("-byte -R aaa bbb -o file", ["-R", "aaa", "bbb"]);
    assertArgs("-byte -I aaa bbb -o file", ["-I", "aaa"]);
    assertArgs("-byte -R aaa bbb -o file -R ccc ddd", [
      "-R",
      "aaa",
      "bbb",
      "-R",
      "ccc",
      "ddd"
    ]);
    assertArgs("-arg foo -byte -R aaa bbb -o file -R ccc ddd", [
      "foo",
      "-R",
      "aaa",
      "bbb",
      "-R",
      "ccc",
      "ddd"
    ]);
    assertArgs('-byte -arg "foo -bar doo" test.v', ["foo", "-bar", "doo"]);
    assertArgs(
      "-arg foo -byte\n-R aaa bbb\n-o file -R ccc ddd\nsome.v\ntest.v",
      ["foo", "-R", "aaa", "bbb", "-R", "ccc", "ddd"]
    );
    assertArgs("-R . mindless\n-arg -impredicative-set\nutils.v\nhypiter.v", [
      "-R",
      ".",
      "mindless",
      "-impredicative-set"
    ]);
  });
});
