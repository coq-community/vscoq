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

(* This component handles delegation to workers. It gathers all the code for
   process management across supported OSes (fork on Unix, create_process +
   marshall on Windows).
   
   For each job to delegate one has to instantiaet the MakeWorker functor
   passin a Job description. Since on Windows we can't fork, one has to
   provide a Job.binary_name to invoke. That process must be a Coq toplevel
   parsing extra argument using [parse_options] then sets up
   a link with master via [setup_plumbing] which provides a function to be
   called to send updates back *)

module type Job = sig
  (** The data out of which the job can be performed. Must be marshalable *)
  type t

  (** Used to craft a job specific command line option for
     the worker process used when fork is not available *)
  val name : string

  (** Name of the worker process binary used when fork is not available *)
  val binary_name : string

  (** Max number of workers for this kind job *)
  val initial_pool_size : int

  type update_request

  (** Called to handle feedback sent by the worker process *)
  val appendFeedback : Feedback.route_id * sentence_id -> (Feedback.level * Loc.t option * Quickfix.t list * Pp.t) -> update_request
end

type job_handle

val cancel_job : job_handle -> unit

(** If the job fails to start, the error is reported on this sentence *)
val mk_job_handle : Feedback.route_id * sentence_id -> job_handle

module type Worker = sig
   type job_t
   type job_update_request

   val resize_pool : int -> unit

   (** Event for the main loop *)
   type delegation
   val pr_event : delegation -> Pp.t
   type events = delegation Sel.Event.t list
   
   (** handling an event may require an update to a sentence in the exec state,
       e.g. when a feedback is received *)
   val handle_event : delegation -> (job_update_request option * events)
   
   (* When a worker is available and the [jobs] queue can be popped the
      event becomes ready; in turn the event triggers the action:
      - if we can fork, job is passed to fork_action
      - otherwise Job.binary_name is spawn and the job sent to it *)
   val worker_available :
     jobs:((job_handle * Sel.Event.cancellation_handle * job_t) Queue.t) ->
     fork_action:(job_t -> send_back:(job_update_request -> unit) -> unit) ->
     feedback_cleanup:(unit -> unit) ->
     delegation Sel.Event.t
   
   (* for worker toplevels *)
   type options
   val parse_options : string list -> options * string list
   (* the sentence ids of the remote_mapping being delegated *)
   val setup_plumbing : options -> ((job_update_request -> unit) * job_t)
   
   (* CDebug aware print *)
   val log : string -> unit
   
end

module MakeWorker (Job : Job) : Worker with type job_t = Job.t and type job_update_request = Job.update_request
