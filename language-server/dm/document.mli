(**************************************************************************)
(*                                                                        *)
(*                                 VSRoc                                  *)
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

type parsing_end_info = {
    unchanged_id: sentence_id option;
    invalid_ids: sentence_id_set;
    previous_document: document;
    parsed_document: document;
}

type event
val pp_event : Format.formatter -> event -> unit

type events = event Sel.Event.t list

val raw_document : document -> RawDocument.t

val create_document : doc_id:document_id -> Vernacstate.Synterp.t -> string -> document
(** [create_document init_synterp_state text] creates a fresh document with content defined by
    [text] under [init_synterp_state]. *)

val validate_document : document -> document * events
(** [validate_document doc] triggers the parsing of the document line by line without
    launching any execution. *)

val handle_event : document -> event -> document * events * parsing_end_info option
(** [handle_event dpc ev] handles a parsing event for the document. One parsing event parses one line
    and prepares the next parsing event. Finally once the full parsing is done, the final event returs
    the id of the bottomost sentence of the prefix which has not changed since the previous validation
    as well as the set of invalidated sentences. *)

type parsed_ast = {
  ast: Synterp.vernac_control_entry;
  classification: Vernacextend.vernac_classification;
  tokens: (Loc.t * Tok.t) list
  (** The token ranges are absolute to the entire document *)
}

type parsing_error = {
  start: int; 
  stop: int; 
  msg: Pp.t Loc.located;
  qf: Quickfix.t list option;
  str: string;
}

type parse_state

val parse_errors : document -> parsing_error list
(** [parse_errors doc] returns the list of sentences which failed to parse
    (see validate_document) together with their error message *)
val apply_text_edit : document -> text_edit -> document
(** [apply_text_edits doc edits] updates the text of [doc] with [edits]. The new
    text is not parsed or executed. *)
val apply_text_edits : document -> text_edit list -> document
(** [apply_text_edits doc edits] updates the text of [doc] with [edits]. The new
    text is not parsed or executed. *)

type sentence_state =
  | Error of parsing_error
  | Parsed of parsed_ast

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
  ast : sentence_state;
  id : sentence_id;
  messages : feedback_message list;
  checked : sentence_checking_result option;
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
val comments : document -> comment list
val code_lines_sorted_by_loc : document -> code_line list
val code_lines_by_end_sorted_by_loc : document -> code_line list
val sentences_sorted_by_loc : document -> sentence list

val get_sentence : document -> sentence_id -> sentence option
val sentences_before : document -> int -> sentence list

val tokens_of_sentence : sentence -> (Loc.t * Tok.t) list
(** [tokens_of_sentence sentence] returns the list of tokens for the given sentence *)

val token_at_loc : sentence -> int -> Tok.t option
(** [token_at_loc sentence loc] returns the token at the given location in the sentence, if any *)

val find_sentence : document -> int -> sentence option
(** [find_sentence doc loc] finds the sentence containing the loc *)

val find_sentence_at_pos : document -> Position.t -> sentence option
(** [find_sentence_at_pos doc pos] finds the sentence at the pos, with leading blank spaces *)

val find_sentence_before : document -> int -> sentence option
(** [find_sentence_before doc loc] finds the last sentence before the loc *)

val find_sentence_before_pos : document -> Position.t -> sentence option
(** [find_sentence_before_pos doc pos] finds the sentence before the pos *)

val find_sentence_after : document -> int -> sentence option
(** [find_sentence_after doc loc] finds the first sentence after the loc *)

val find_sentence_after_pos : document -> Position.t -> sentence option
(** [find_sentence_after_pos doc pos] finds the first sentence after the pos *)

val find_next_qed : document -> int -> sentence option
(** [find_next_qed parsed loc] finds the next proof end *)

val find_next_qed_pos : document -> Position.t -> sentence option
(** [find_next_qed_pos parsed pos] finds the next proof end *)

val get_first_sentence : document  -> sentence option
(** [get_first_sentence doc] returns the first parsed sentence *)

val get_last_sentence : document  -> sentence option
(** [get_last_sentence doc] returns the last parsed sentence *)

val is_sentence_above : document -> sentence_id -> sentence_id -> bool
(** [is_sentence_above doc id1 id2] check is id1 is above id2 *)

val schedule : document -> Scheduler.schedule

val has_sentence : document -> sentence_id -> bool
(** [has_sentence doc id] tells if id is in the document *)

val range_of_id : document -> sentence_id -> Range.t
(** [range_of_id doc id] returns a Range object coressponding to the sentence id given in argument *)

val range_of_id_with_blank_space : document -> sentence_id -> Range.t
(** [range_of_id_with_blank_space doc id] returns a Range object coressponding to the sentence id given in argument but with the white spaces before (until the previous sentence) *)

val range_of_document : document -> Range.t
(** [range_of_document doc] returns a Range object corresponding to the whole document *)

val all_feedback : document -> (sentence_id * feedback_message) list
(** [all_feedback doc] returns all sentences with a feedback *)

val feedback : document -> sentence_id -> feedback_message list
(** [feedback doc id] returns all feedback messages for id *)

val all_checking_errors : document -> (sentence_id * (Loc.t option * Pp.t * Quickfix.t list option)) list
(** [all_checking_errors doc] returns all sentences that were checked and resulted in an error *)

val error : document -> sentence_id -> (Loc.t option * Pp.t * Quickfix.t list option) option
(** [error doc id] returns the checking error for id, if any *)

val append_feedback : document -> sentence_id -> feedback_message -> document
(** [append_feedback doc id msg] appends msg to existing messages on id *)

val shift_feedbacks_and_checking_errors : start:int -> offset:int -> document -> document
(** [shift_feedbacks_and_checking_errors ~start ~stop doc] shifts all messages past start by offset *)

val update_checked : document -> sentence_id * sentence_checking_result -> document
(** [update_checked doc id v] updates the checked field of sentence id *)

val set_unchecked : document -> sentence_id -> document
(** [remove_checked doc id] marks id as unchecked *)

val is_checked : document -> sentence_id -> bool
(** [is_checked doc id] tells if id is checked *)

val id : document -> document_id

module Internal : sig

  val string_of_sentence : sentence -> string
  val string_of_item : code_line -> string

end
