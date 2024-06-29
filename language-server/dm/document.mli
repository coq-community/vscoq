(**************************************************************************)
(*                                                                        *)
(*                                 VSCoq                                  *)
(*                                                                        *)
(*                   Copyright INRIA and contributors                     *)
(*       (see version control and README file for authors & dates)        *)
(*                                                                        *)
(**************************************************************************)
(*                                                                        *)
(*   This file is distributed under the terms of the MIT License.         *)
(*   See LICENSE file.                                                    *)
(*                                                                        *)
(**************************************************************************)

open Types
open Lsp.Types

(** This file defines operations on the content of a document (text, parsing
    of sentences, scheduling). *)

(** The document gathers the text, which is partially validated (parsed into
    sentences *)
type document

val raw_document : document -> RawDocument.t

val create_document : Vernacstate.Synterp.t -> string -> document
(** [create_document init_synterp_state text] creates a fresh document with content defined by
    [text] under [init_synterp_state]. *)

val validate_document : document -> sentence_id option * sentence_id_set * document
(** [validate_document doc] parses the document without forcing any execution
    and returns the id of the bottommost sentence of the prefix which has not changed
    since the previous validation, as well as the set of invalidated sentences *)

type parsed_ast = {
  ast: Synterp.vernac_control_entry;
  classification: Vernacextend.vernac_classification;
  tokens: Tok.t list
}

type parsing_error = {
  start: int; 
  stop: int; 
  msg: string Loc.located;
  qf: Quickfix.t list option;
}

val parse_errors : document -> parsing_error list
(** [parse_errors doc] returns the list of sentences which failed to parse
    (see validate_document) together with their error message *)

val apply_text_edits : document -> text_edit list -> document
(** [apply_text_edits doc edits] updates the text of [doc] with [edits]. The new
    text is not parsed or executed. *)

(* Example:                        *)
(* "  Check 3. "                    *)
(* ^  ^       ^---- end            *)
(* |  |------------ start          *)
(* |---------------- parsing_start *)
type sentence = {
  parsing_start : int;
  start : int;
  stop : int;
  synterp_state : Vernacstate.Synterp.t; (* synterp state after this sentence's synterp phase *)
  scheduler_state_before : Scheduler.state;
  scheduler_state_after : Scheduler.state;
  ast : parsed_ast;
  id : sentence_id;
}

type comment = {
  start : int;
  stop : int;
  content: string;
}

type code_line =
  | Sentence of sentence
  | ParsingError of parsing_error
  | Comment of comment

val sentences : document -> sentence list
val code_lines_sorted_by_loc : document -> code_line list
val sentences_sorted_by_loc : document -> sentence list

val get_sentence : document -> sentence_id -> sentence option
val sentences_before : document -> int -> sentence list

val find_sentence : document -> int -> sentence option
(** [find_sentence pos loc] finds the sentence containing the loc *)

val find_sentence_before : document -> int -> sentence option
(** [find_sentence_before pos loc] finds the last sentence before the loc *)

val find_sentence_after : document -> int -> sentence option
(** [find_sentence_after pos loc] finds the first sentence after the loc *)

val find_next_qed : document -> int -> sentence option
(** [find_next_qed parsed loc] finds the next proof end *)

val get_first_sentence : document  -> sentence option
(** [get_first_sentence doc] returns the first parsed sentence *)

val get_last_sentence : document  -> sentence option
(** [get_last_sentence doc] returns the last parsed sentence *)

val schedule : document -> Scheduler.schedule

val range_of_id : document -> Stateid.t -> Range.t
(** [range_of_id doc id] returns a Range object coressponding to the sentence id given in argument *)

val range_of_id_with_blank_space : document -> Stateid.t -> Range.t
(** [range_of_id_with_blank_space doc id] returns a Range object coressponding to the sentence id given in argument but with the white spaces before (until the previous sentence) *)

module Internal : sig

  val string_of_sentence : sentence -> string
  val string_of_item : code_line -> string

end