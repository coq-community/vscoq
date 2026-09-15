open Base
open Dm
open Common

[@@@warning "-27"]

(* --- helpers --- *)

let document_range_of st =
  Document.range_of_document (DocumentManager.Internal.document st)

let assert_range_eq (expected : Lsp.Types.Range.t) (actual : Lsp.Types.Range.t) =
  [%test_eq: int] actual.start.line expected.start.line;
  [%test_eq: int] actual.start.character expected.start.character;
  [%test_eq: int] actual.end_.line expected.end_.line;
  [%test_eq: int] actual.end_.character expected.end_.character

let nth_sentence doc i =
  List.nth_exn (Document.sentences_sorted_by_loc doc) i

let position_le (a : Lsp.Types.Position.t) (b : Lsp.Types.Position.t) =
  a.line < b.line || (a.line = b.line && a.character <= b.character)

let range_contains (parent : Lsp.Types.Range.t) (child : Lsp.Types.Range.t) =
  position_le parent.start child.start && position_le child.end_ parent.end_


(* --- tests --- *)

let %test_unit "range_of_document.empty_document_returns_document" =
  let text = "" in
  let st, events_ = em_init_test_doc ~text in
  let range = document_range_of st in
  [%test_eq: int] range.start.line 0;
  [%test_eq: int] range.start.character 0;
  [%test_eq: int] range.end_.line 0;
  [%test_eq: int] range.end_.character 0

let %test_unit "range_of_document.multi_sentence_returns_correct_range" =
  let text = "Definition x := 3.\n Lemma foo : x = 3.\n Proof.\n reflexivity.\n Qed." in
  let st, events_ = em_init_test_doc ~text in
  let range = document_range_of st in
  [%test_eq: int] range.start.line 0;
  [%test_eq: int] range.start.character 0;
  [%test_eq: int] range.end_.line 4;
  [%test_eq: int] range.end_.character (String.length " Qed.")

let %test_unit "range_of_document.includes_leading_trailing_newlines" =
  let text = "\n Definition x := 3.\n\n" in
  let st, events_ = em_init_test_doc ~text in
  let range = document_range_of st in
  [%test_eq: int] range.end_.line 3;
  [%test_eq: int] range.end_.character 0

let%test_unit "selection_range.empty_document_returns_document" =
  let text = "" in
  let st, events_ = em_init_test_doc ~text in
  let pos : Lsp.Types.Position.t = { line = 0; character = 0 } in
  let expected_range = document_range_of st in
  let result = DocumentManager.get_selection_range st pos in
  [%test_eq: bool] (Option.is_none result.parent) true;
  assert_range_eq expected_range result.range

let%test_unit "selection_range.single_sentence_returns_eq_sentence_document" =
  let text = "intros." in
  let st, events_ = em_init_test_doc ~text in
  let doc = DocumentManager.Internal.document st in
  let sentence = nth_sentence doc 0 in
  let pos : Lsp.Types.Position.t = { line = 0; character = 4 } in
  let expected_range = Document.range_of_id doc sentence.id in
  let expected_parent = document_range_of st in
  let result = DocumentManager.get_selection_range st pos in
  assert_range_eq expected_range result.range;
  assert_range_eq expected_parent result.range

let%test_unit "selection_range.inside_sentence_returns_sentence_document" =
  let text =
    "Definition x := 3. Lemma foo : x = 3. Proof. reflexivity. Qed."
  in
  let st, events_ = em_init_test_doc ~text in
  let doc = DocumentManager.Internal.document st in
  let sentence = nth_sentence doc 1 in
  let pos : Lsp.Types.Position.t = { line = 0; character = 27 } in
  let expected_range = Document.range_of_id doc sentence.id in
  let expected_parent = document_range_of st in
  let result : Lsp.Types.SelectionRange.t = DocumentManager.get_selection_range st pos in
  assert_range_eq expected_range result.range;
  [%test_eq: bool] (Option.is_some result.parent) true;
  match result.parent with
  | None -> failwith "unreachable"
  | Some parent -> assert_range_eq expected_parent parent.range

let%test_unit "selection_range.start_of_sentence_returns_correct_sentence_document" =
  let text =
    "Definition x := 3. Lemma foo : x = 3. Proof. reflexivity. Qed."
  in
  let st, events_ = em_init_test_doc ~text in
  let doc = DocumentManager.Internal.document st in
  let sentence = nth_sentence doc 1 in
  let pos : Lsp.Types.Position.t = { line = 0; character = 19 } in
  let expected_range = Document.range_of_id doc sentence.id in
  let expected_parent = document_range_of st in
  let result : Lsp.Types.SelectionRange.t = DocumentManager.get_selection_range st pos in
  assert_range_eq expected_range result.range;
  [%test_eq: bool] (Option.is_some result.parent) true;
  match result.parent with
  | None -> failwith "unreachable"
  | Some parent -> assert_range_eq expected_parent parent.range

let%test_unit "selection_range.end_of_sentence_returns_correct_sentence_document" =
  let text =
    "Definition x := 3. Lemma foo : x = 3. Proof. reflexivity. Qed."
  in
  let st, events_ = em_init_test_doc ~text in
  let doc = DocumentManager.Internal.document st in
  let sentence = nth_sentence doc 1 in
  let pos : Lsp.Types.Position.t = { line = 0; character = 37 } in
  let expected_range = Document.range_of_id doc sentence.id in
  let expected_parent = document_range_of st in
  let result : Lsp.Types.SelectionRange.t = DocumentManager.get_selection_range st pos in
  assert_range_eq expected_range result.range;
  [%test_eq: bool] (Option.is_some result.parent) true;
  match result.parent with
  | None -> failwith "unreachable"
  | Some parent -> assert_range_eq expected_parent parent.range

let%test_unit "selection_range.between_sentences_returns_next_sentence_document" =
  let text =
    "Definition x := 3.  Lemma foo : x = 3."
  in
  let st, events_ = em_init_test_doc ~text in
  let doc = DocumentManager.Internal.document st in
  let sentence = nth_sentence doc 1 in
  let pos : Lsp.Types.Position.t = { line = 0; character = 19 } in
  let expected_range = Document.range_of_id doc sentence.id in
  let expected_parent = document_range_of st in
  let result : Lsp.Types.SelectionRange.t = DocumentManager.get_selection_range st pos in
  assert_range_eq expected_range result.range;
  [%test_eq: bool] (Option.is_some result.parent) true;
  match result.parent with
  | None -> failwith "unreachable"
  | Some parent -> assert_range_eq expected_parent parent.range

let%test_unit "selection_range.after_last_sentence_returns_document" =
  let text =
    "Definition x := 3.  Lemma foo : x = 3. Proof. reflexivity. Qed.
                "
  in
  let st, events_ = em_init_test_doc ~text in
  let pos : Lsp.Types.Position.t = { line = 1; character = 6 } in
  let expected_range = document_range_of st in
  let result = DocumentManager.get_selection_range st pos in
  [%test_eq: bool] (Option.is_none result.parent) true;
  assert_range_eq expected_range result.range

let%test_unit "selection_range.document_range_includes_leading_and_trailing" =
  let text =
    "             Definition x := 3.  Lemma foo : x = 3.
                  "
  in
  let st, events_ = em_init_test_doc ~text in
  let pos : Lsp.Types.Position.t = { line = 0; character = 20 } in
  let expected_parent = document_range_of st in
  let result : Lsp.Types.SelectionRange.t = DocumentManager.get_selection_range st pos in
  [%test_eq: bool] (Option.is_some result.parent) true;
  match result.parent with
  | None -> failwith "unreachable"
  | Some parent -> assert_range_eq expected_parent parent.range

let%test_unit "selection_range.sentence_document_chains_are_nested" =
  let text =
    "Definition x := 3. Lemma foo : x = 3. Proof. reflexivity. Qed."
  in
  let st, events_ = em_init_test_doc ~text in
  let pos : Lsp.Types.Position.t = { line = 0; character = 27 } in
  let result : Lsp.Types.SelectionRange.t = DocumentManager.get_selection_range st pos in
  [%test_eq: bool] (Option.is_some result.parent) true;
  match result.parent with
  | None -> failwith "unreachable"
  | Some parent -> [%test_eq: bool] (range_contains parent.range result.range) true
