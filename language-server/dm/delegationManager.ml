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

let Log log = Log.mk_log "delegationManager"

type sentence_id = Stateid.t

type link = {
  write_to :  Unix.file_descr;
  read_from:  Unix.file_descr;
}

let write_value { write_to; _ } x =
(* alert: calling log from write value causes a loop, since log (from the worker)
    writes the value to a channel. Hence we mask [log] *)
  let [@warning "-26"] log _ = () in
  let data = Marshal.to_bytes x [] in
  let datalength = Bytes.length data in
  let writeno = Unix.write write_to data 0 datalength in
  assert(writeno = datalength);
  flush_all ()

let abort_on_unix_error f x =
  try
    f x
  with Unix.Unix_error(e,f,p) ->
    Printf.eprintf "Error: %s: %s: %s\n%!" f p (Unix.error_message e);
    exit 3


type job_handle = (Feedback.route_id * sentence_id) * int option ref

module type Job = sig
  type t
  val name : string
  val binary_name : string
  val initial_pool_size : int
  type update_request
  val appendFeedback : Feedback.route_id * sentence_id -> (Feedback.level * Loc.t option * Quickfix.t list * Pp.t) -> update_request
end

(* One typically created a job id way before the worker is spawned, so we
   allocate a slot for the PID, but set it later. The sentence_id is used
   for error reporting (e.g. fail to spawn) *)
let mk_job_handle (rid, sid) : job_handle = (rid, sid), ref None

let cancel_job (_,id) =
  match !id with
  | None -> ()
  | Some pid -> Unix.kill pid 9

(* TODO: this queue should not be here, it should be "per URI" but we want to
   keep here the conversion (STM) feedback -> (LSP) feedback *)

let install_feedback send =
  Log.feedback_add_feeder_on_Message (fun route span _ lvl loc qf msg ->
    send (route,span,(lvl,loc, qf, msg)))
    
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

module MakeWorker (Job : Job) = struct
type job_t = Job.t
type job_update_request = Job.update_request

type worker_message =
  | Job_update of Job.update_request
  | DebugMessage of Log.event

let Log log_worker = Log.mk_log ("worker." ^ Job.name)

let install_feedback_worker ~feedback_cleanup link =
  feedback_cleanup ();
  ignore(install_feedback (fun (rid,id,fb) -> write_value link (Job.appendFeedback (rid, id) fb)))

type feedback_cleanup = unit -> unit
(* This is the lifetime of a delegation, there is one start event, many progress
   evants, then one ending event. *)
type delegation =
 | WorkerStart : feedback_cleanup * job_handle * 'job * ('job -> send_back:(Job.update_request -> unit) -> unit) * string -> delegation
 | WorkerProgress of { link : link; update_request : worker_message } (* TODO: use a recurring event (+cancel) and remove link *)
 | WorkerEnd of (int * Unix.process_status)
 | WorkerIOError of exn
let pr_event = function
  | WorkerEnd _ -> Pp.str "WorkerEnd"
  | WorkerIOError _ -> Pp.str "WorkerIOError"
  | WorkerProgress _ -> Pp.str "WorkerProgress"
  | WorkerStart _ -> Pp.str "WorkerStart"

let install_debug_worker link =
  Log.worker_initialization_done
    ~fwd_event:(fun e -> write_value link (DebugMessage e))

type events = delegation Sel.Event.t list

type role = Master | Worker of link

(* The pool is just a queue of tokens *)
let pool = Queue.create ()
let () =
  assert(Job.initial_pool_size >= 1);
  for _i = 0 to Job.initial_pool_size do Queue.push () pool done
let current_pool_size = ref Job.initial_pool_size
let resize_pool new_pool_size =
  assert(new_pool_size >= 1);
  let delta = !current_pool_size - new_pool_size in
  current_pool_size := new_pool_size;
  (* We add tokens if needed *)
  if delta < 0 then for _i = 1 to abs(delta) do Queue.push () pool done;
  (* We remove tokens if needed, the ones currently in use are not added back.
     See handling of WorkerEnd and WorkerIOError *)
  if delta > 0 then for _i = 1 to abs(delta) do ignore(Queue.take_opt pool) done
;;

(* In order to create a job we enqueue this event *)
let worker_available ~jobs ~fork_action ~feedback_cleanup : delegation Sel.Event.t =
  Sel.On.queues jobs pool (fun (job_handle, _, job) () ->
    WorkerStart (feedback_cleanup,job_handle,job,fork_action,Job.binary_name))

(* When a worker is spawn, we enqueue this event, since eventually it will die *)
let worker_ends pid : delegation Sel.Event.t =
  Sel.On.death_of ~pid (fun reason -> WorkerEnd(pid,reason))

(* When a worker is spawn, we enqueue this event, since eventually will make progress *)
let worker_progress link : delegation Sel.Event.t =
  Sel.On.ocaml_value link.read_from (function
    | Error e -> WorkerIOError e
    | Ok update_request -> WorkerProgress { link; update_request; })

(* ************ spawning *************************************************** *)

let accept_timeout ?(timeout=2.0) sr =
  let r, _, _ = Unix.select [sr] [] [] timeout in
  if r = [] then None
  else Some (Unix.accept sr)

let fork_worker : feedback_cleanup:feedback_cleanup -> int option ref -> (role * events, string * events) result = fun ~feedback_cleanup cancellation_handle ->
  let open Unix in
  try
    let chan = socket PF_INET SOCK_STREAM 0 in
    bind chan (ADDR_INET (Unix.inet_addr_loopback,0));
    listen chan 1;
    let address = getsockname chan in
    log @@ "forking...";
    flush_all ();
    let null = openfile "/dev/null" [O_RDWR] 0o640 in
    let pid = fork () in
    if pid = 0 then begin
        (* Children process *)
        dup2 null stdin;
        dup2 null stdout;
        close chan;
        Log.worker_initialization_begins ();
        let chan = socket PF_INET SOCK_STREAM 0 in
        connect chan address;
        let read_from = chan in
        let write_to = chan in
        let link = { write_to; read_from } in
        install_feedback_worker ~feedback_cleanup link;
        install_debug_worker link;
        log_worker @@ "borning...";
        Ok (Worker link, [])
    end else
      (* Parent process *)
      let () = cancellation_handle := Some pid in
      match accept_timeout chan with
      | None ->
          close chan;
          log @@ Printf.sprintf "forked pid %d did not connect back" pid;
          Unix.kill pid 9;
          Error ("worker did not connect back", [worker_ends pid])
      | Some (worker, _worker_addr) ->
          close chan;
          log @@ Printf.sprintf "forked pid %d called back" pid;
          let read_from = worker in
          let write_to = worker in
          let link = { write_to; read_from } in
          Ok (Master, [worker_progress link; worker_ends pid])
  with Unix_error(e,f,p) ->
    Error (f ^": "^ p^": " ^error_message e,[])

;;

let option_name = "-" ^ Str.global_replace (Str.regexp_string " ") "." Job.name ^ "_master_address"

let create_process_worker procname cancellation_handle job =
  let open Unix in
  try
    let chan = socket PF_INET SOCK_STREAM 0 in
    bind chan (ADDR_INET (Unix.inet_addr_loopback,0));
    listen chan 1;
    let port = match getsockname chan with
      | ADDR_INET(_,port) -> port
      | _ -> assert false in
    let null = openfile "/dev/null" [O_RDWR] 0o640 in
    let extra_flags = if CDebug.get_flags () = "all" then [|"-debug"|] else [||] in
    let args = Array.append  [|procname;option_name;string_of_int port|] extra_flags in
    let pid = create_process procname args null stdout stderr in
    close null;
    let () = cancellation_handle := Some pid in
    log @@ Printf.sprintf "created worker %d, waiting on port %d" pid port;
    match accept_timeout chan with
    | Some(worker, _worker_addr) ->
        close chan;
        let read_from = worker in
        let write_to = worker in
        let link = { write_to; read_from } in
        install_feedback_worker ~feedback_cleanup:(fun _ -> ()) link;
        install_debug_worker link;
        log @@ "sending job";
        write_value link job;
        flush_all ();
        log @@ "sent";
        Ok [worker_progress link; worker_ends pid]
    | None ->
        log @@ Printf.sprintf "child process %d did not connect back" pid;
        Unix.kill pid 9;
        Error ("worker did not connect back", [worker_ends pid])
  with Unix_error(e,f,p) ->
    Error (f ^": "^ p^": " ^error_message e,[])


(* **************** /spawning ********************************************** *)

let handle_event = function
  | WorkerIOError e ->
     log @@ "worker IO Error: " ^ Printexc.to_string e;
     if Queue.length pool < !current_pool_size then
      Queue.push () pool;
     (None, [])
  | WorkerEnd (pid, _status) ->
      log @@ Printf.sprintf "worker %d went on holidays" pid;
      if Queue.length pool < !current_pool_size then
        Queue.push () pool;
      (None,[])
  | WorkerProgress { link; update_request = DebugMessage d } ->
      Log.handle_event d;
      (None, [worker_progress link])
  | WorkerProgress { link; update_request = Job_update u } ->
      log "worker progress";
      (Some u, [worker_progress link])
  | WorkerStart (feedback_cleanup, (feedback_route,cancellation_handle),job,action,procname) ->
    log "worker starts";
    if Sys.os_type = "Unix" then
      match fork_worker ~feedback_cleanup cancellation_handle with
      | Ok(Master, events) ->
        log "worker spawned (fork)";
        (None, events)
      | Ok(Worker link, _) ->
        action job ~send_back:(fun j -> abort_on_unix_error write_value link (Job_update j));
        exit 0
      | Error(msg, cleanup_events) ->
        log @@ "worker did not spawn: " ^ msg;
        (Some(Job.appendFeedback feedback_route (Feedback.Error,None,[],Pp.str msg)), cleanup_events)
    else
      match create_process_worker procname cancellation_handle job with
      | Ok events ->
          log "worker spawned (create_process)";
          (None, events)
      | Error(msg, cleanup_events) ->
          log @@ "worker did not spawn: " ^ msg;
          (Some(Job.appendFeedback feedback_route (Feedback.Error,None,[],Pp.str msg)), cleanup_events)


(* the only option is the socket port *)
type options = int

let setup_plumbing port =
  try
    let open Unix in
    let chan = socket PF_INET SOCK_STREAM 0 in
    let address = ADDR_INET (inet_addr_loopback,port) in
    log_worker @@ "connecting to " ^ string_of_int port;
    connect chan address;
    let read_from = chan in
    let write_to = chan in
    let link = { read_from; write_to } in
    (* Unix.read_value does not exist, we use Sel *)
    match Sel.(pop Todo.(add empty [Sel.On.ocaml_value read_from (fun x -> x)])) with
    | Ok (job : Job.t), _ -> (write_value link, job)
    | Error exn, _ ->
      log_worker @@ "error receiving job: " ^ Printexc.to_string exn;
      exit 1
  with Unix.Unix_error(code,syscall,param) ->
    log_worker @@ Printf.sprintf "error starting: %s: %s: %s" syscall param (Unix.error_message code);
    exit 1

let parse_options extra_args =
  match extra_args with
  | [ o ; port ] when o = option_name -> int_of_string port, []
  | _ ->
    Printf.eprintf "unknown arguments: %s" (String.concat " " extra_args);
    exit 2

let log = log_worker

end
