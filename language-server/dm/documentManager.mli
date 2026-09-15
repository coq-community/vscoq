(**************************************************************************)
(*                                                                        *)
(*                                 VSRocq                                  *)
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
open Protocol
open Protocol.LspWrapper
open Protocol.Printing
open CompletionItems

(** The document manager holds the view that Rocq has of the currently open
    states. It makes it easy for IDEs to handle text edits, navigate
    and get feedback. Note that it does not require IDEs to parse vernacular
    sentences. *)

type blocking_error = {
  last_range: Range.t;
  error_range: Range.t
}

type state

type event
val pp_event : Format.formatter -> event -> unit

type events = event Sel.Event.t list

val is_parsing : state -> bool

val init : Vernacstate.t -> opts:Coqargs.injection_command list -> DocumentUri.t -> text:string -> state * events
(** [init st opts uri text] initializes the document manager with initial vernac state
    [st] on which command line opts will be set. *)

val apply_text_edits : state -> text_edit list -> state * events
(** [apply_text_edits doc edits] updates the text of [doc] with [edits]. 
    A ParseEvent is triggered, once processed: the new
    document is parsed, outdated executions states are invalidated, and the observe
    id is updated. *)

val reset_to_top : state -> state
(** [reset_to_top state] updates the state to make the observe_id Top *)

val get_next_range : state -> Position.t -> Range.t option
(** [get_next_range st pos] get the range of the next sentence relative to pos *)

val get_previous_range : state -> Position.t -> Range.t option
(** [get_previous_pos st pos] get the range of the previous sentence relative to pos *)

val interpret_to_position : Position.t -> events
(** [interpret_to_position pos] navigates to the 
    last sentence ending before or at [pos] and returns the resulting state, events that need to take place, and a possible blocking error. *)

val interpret_to_previous : unit -> events
(** [interpret_to_previous] navigates to the previous sentence in [doc]
    and returns the resulting state. *)

val interpret_to_next : unit -> events
(** [interpret_to_next] navigates to the next sentence in [doc]
    and returns the resulting state. *)

val interpret_to_end : unit -> events
(** [interpret_to_end] navigates to the last sentence in [doc]
    and returns the resulting state. *)

val interpret_in_background : state -> (state * events)
(** [interpret_in_background doc] same as [interpret_to_end] but computation 
    is done in background (with lower priority) *)

val reset : state -> state * events 
(** resets Rocq *)

val interrupt_execution : state -> unit
(** [interrupt_execution st] cancels any ongoing execution on [st] *)

val executed_ranges : state -> exec_overview
(** [executes_ranges doc] returns the ranges corresponding to the sentences
    that have been executed. [settings.check_mode] allows to send a "cut" range that only goes
    until the observe_id in the case of manual mode *)

val observe_id_range : state -> Range.t option
(** returns the range of the sentence referenced by observe_id **)

val get_messages : state -> sentence_id -> (DiagnosticSeverity.t * pp) list
(** returns the messages associated to a given position *)

val get_info_messages : state -> Position.t option -> (DiagnosticSeverity.t * pp) list
(** returns the Feedback.Info level messages associated to a given position *)

val get_document_symbols : state -> DocumentSymbol.t list

val get_folding_ranges : state -> FoldingRange.t list

val get_selection_range : state -> Position.t -> SelectionRange.t
(** [get_selection_range st pos] returns the selection range at pos *)

val get_document_proofs : state -> ProofState.proof_block list

val all_diagnostics : state -> Diagnostic.t list
(** all_diagnostics [doc] returns the diagnostics corresponding to the sentences
    that have been executed in [doc]. *)

val get_completions : state -> Position.t -> completion_item list 

val handle_event : event -> state -> (state,event) handled_event
(** handles events and returns a new state if it was updated. On top of the next events, it also returns info
    on whether execution has halted due to an error and returns a boolean flag stating whether the view
    should be updated *)

val search : state -> id:string -> Position.t -> string -> notification Sel.Event.t list

val about : state -> Position.t -> pattern:string -> (pp,error) Result.t

val hover : state -> Position.t -> MarkupContent.t option
(** Returns an optional Result:
    if None, the position did not have a word,
    if Some, an Ok/Error result is returned. *)

val highlight : state -> Position.t -> Range.t list

val jump_to_definition : state -> Position.t -> (Range.t * string) option

val check : state -> Position.t -> pattern:string -> (pp,error) Result.t

val locate : state -> Position.t -> pattern:string -> (pp, error) Result.t

val print : state -> Position.t -> pattern:string -> (pp, error) Result.t


module Internal : sig

  val document : state -> Document.document
  val raw_document : state -> RawDocument.t
  val is_locally_executed : state -> sentence_id -> bool
  val string_of_state : state -> string
  val observe_id : state -> sentence_id option
  val folding_entries : state -> DocumentEntries.entries option
  val inject_doc_events : Document.event Sel.Event.t list -> event Sel.Event.t list
  val get_proof : state -> sentence_id option -> ProofState.t option
  val validate_document : state -> Document.parsing_end_info -> state


end
