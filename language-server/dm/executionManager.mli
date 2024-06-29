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
open Protocol

(** The event manager is in charge of the actual event of tasks (as
    defined by the scheduler), caching event states and invalidating
    them. It can delegate to worker processes via DelegationManager *)

type delegation_mode =
  | CheckProofsInMaster
  | SkipProofs
  | DelegateProofsToWorkers of { number_of_workers : int }

type options = {
  delegation_mode : delegation_mode;
  completion_options : Settings.Completion.t;
  enableDiagnostics : bool;
}

val is_diagnostics_enabled: unit -> bool

(** Execution state, includes the cache *)
type state
type event
type events = event Sel.Event.t list

type feedback_message = Feedback.level * Loc.t option * Quickfix.t list * Pp.t

val pr_event : event -> Pp.t

val init : Vernacstate.t -> state * event Sel.Event.t
val destroy : state -> unit

val get_options : unit -> options
val set_options : options -> unit
val set_default_options : unit -> unit
val invalidate : Document.document -> Scheduler.schedule -> sentence_id -> state -> state

val error : state -> sentence_id -> (Loc.t option * Pp.t) option
val feedback :  state -> sentence_id -> feedback_message list
val all_errors : state -> (sentence_id * (Loc.t option * Pp.t * Quickfix.t list option)) list
val all_feedback : state -> (sentence_id * feedback_message) list

val shift_diagnostics_locs : state -> start:int -> offset:int -> state
val executed_ids : state -> sentence_id list
val is_executed : state -> sentence_id -> bool
val is_remotely_executed : state -> sentence_id -> bool

val get_context : state -> sentence_id -> (Evd.evar_map * Environ.env) option
val get_initial_context : state -> Evd.evar_map * Environ.env

(** Returns the vernac state after the sentence *)
val get_vernac_state : state -> sentence_id -> Vernacstate.t option

(** Events for the main loop *)
val handle_event : event -> state -> (sentence_id option * state option * events)

(** Execution happens in two steps. In particular the event one takes only
    one task at a time to ease checking for interruption *)
type prepared_task
val build_tasks_for : Document.document -> Scheduler.schedule -> state -> sentence_id -> Vernacstate.t * prepared_task list * state
val execute : state -> Vernacstate.t * events * bool -> prepared_task -> (state * Vernacstate.t * events * bool)

val update_overview : prepared_task -> prepared_task list -> state -> Document.document -> state
val update_processed : sentence_id -> state -> Document.document -> state
val prepare_overview : state -> LspWrapper.Range.t list -> state
val overview : state -> exec_overview
val overview_until_range : state -> LspWrapper.Range.t -> exec_overview
val print_exec_overview : state -> unit

(** Coq toplevels for delegation without fork *)
module ProofWorkerProcess : sig
  type options
  val parse_options : string list -> options * string list
  val main : st:Vernacstate.t -> options -> unit
  val log : string -> unit
end
