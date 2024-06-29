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

let Log log = Log.mk_log "parTactic"

type sentence_id = Stateid.t

module TacticJob = struct
  type solution =
    | Solved of Constr.t * UState.t
    | NoProgress
    | Error of Pp.t
  type update_request =
    | UpdateSolution of Evar.t * solution
    | AppendFeedback of Feedback.route_id * sentence_id * (Feedback.level * Loc.t option * Quickfix.t list * Pp.t)
  let appendFeedback (rid,id) fb = AppendFeedback(rid,id,fb)

  type t =  {
    state    : Vernacstate.t;
    ast      : ComTactic.interpretable;
    goalno   : int;
    goal     : Evar.t;
    name     : string }
  let name = "tactic"
  let binary_name = "vscoqtop_tactic_worker.opt"
  let initial_pool_size = 2

end

module TacticWorker = DelegationManager.MakeWorker(TacticJob)


let assign_tac ~abstract res : unit Proofview.tactic =
  Proofview.(Goal.enter begin fun g ->
    let gid = Goal.goal g in
    try
      let pt, uc = List.assoc gid res in
      let open Notations in
      let push_state ctx =
          Proofview.tclEVARMAP >>= fun sigma ->
          Proofview.Unsafe.tclEVARS (Evd.merge_universe_context sigma ctx)
      in
      (if abstract then Abstract.tclABSTRACT None else (fun x -> x))
          (push_state uc <*> Tactics.exact_no_check (EConstr.of_constr pt))
    with Not_found ->
      log @@ "nothing for " ^ Pp.string_of_ppcmds @@ Evar.print gid;
      tclUNIT ()
  end)

[%%if coq = "8.18" || coq = "8.19"]
let command_focus = Proof.new_focus_kind ()
[%%else]
let command_focus = Proof.new_focus_kind "vscoq_command_focus"
[%%endif]

let worker_solve_one_goal { TacticJob.state; ast; goalno; goal } ~send_back =
  let focus_cond = Proof.no_cond command_focus in
  let pr_goal g = string_of_int (Evar.repr g) in
  Vernacstate.unfreeze_full_state state;
  try
    Vernacstate.LemmaStack.with_top (Option.get state.Vernacstate.interp.lemmas) ~f:(fun pstate ->
    let pstate = Declare.Proof.map pstate ~f:(Proof.focus focus_cond () goalno) in
    let pstate = ComTactic.solve ~pstate Goal_select.SelectAll ~info:None ast ~with_end_tac:false in
    let { Proof.sigma } = Declare.Proof.fold pstate ~f:Proof.data in
    let EvarInfo evi = Evd.find sigma goal in
    match Evd.(evar_body evi) with
    | Evd.Evar_empty ->
        log @@ "no progress on goal " ^ pr_goal goal;
        send_back (TacticJob.UpdateSolution (goal,TacticJob.NoProgress))
    | Evd.Evar_defined t ->
        let t = Evarutil.nf_evar sigma t in
        let evars = Evarutil.undefined_evars_of_term sigma t in
        if Evar.Set.is_empty evars then
          let t = EConstr.Unsafe.to_constr t in
          log @@ "closed goal " ^ pr_goal goal;
          send_back (TacticJob.UpdateSolution (goal,TacticJob.Solved(t, Evd.evar_universe_context sigma)))
        else
          CErrors.user_err
            Pp.(str"The par: selector requires a tactic that makes no progress or fully" ++
                str" solves the goal and leaves no unresolved existential variables. The following" ++
                str" existentials remain unsolved: " ++ prlist (Termops.pr_existential_key (Global.env ()) sigma) (Evar.Set.elements evars))
    )
  with e when CErrors.noncritical e ->
    send_back (TacticJob.UpdateSolution (goal, TacticJob.Error Pp.(CErrors.print e ++ spc() ++ str "(for subgoal "++int goalno ++ str ")")))

let feedback_id = ref (0,Stateid.dummy)
let set_id_for_feedback rid sid = feedback_id := (rid,sid)

let interp_par ~pstate ~info ast ~abstract ~with_end_tac : Declare.Proof.t =
  let state = Vernacstate.freeze_full_state () in
  let state = Vernacstate.Stm.make_shallow state in
  let queue = Queue.create () in
  let events, job_ids = List.split @@
    Declare.Proof.fold pstate ~f:(fun p ->
     (Proof.data p).Proof.goals |> CList.map_i (fun goalno goal ->
       let job = { TacticJob.state; ast; goalno = goalno + 1; goal; name = string_of_int (Evar.repr goal)} in
       let job_id = DelegationManager.mk_job_handle !feedback_id in
       let e =
         TacticWorker.worker_available ~feedback_cleanup:(fun _ -> ()) (* not really correct, since there is a cleanup to be done, but it concern a sel loop which is dead (we don't come back to it), so we can ignore the problem *)
           ~jobs:queue ~fork_action:worker_solve_one_goal in
       Queue.push (job_id, Sel.Event.get_cancellation_handle e, job) queue;
        e, job_id
      ) 0) in
  let rec wait acc evs =
    log @@ "waiting for events: " ^ string_of_int @@ Sel.Todo.size evs;
    let more_ready, evs = Sel.pop_opt evs in
    match more_ready with
    | None ->
        if Sel.Todo.is_empty evs then (log @@ "done waiting for tactic workers"; acc)
        else wait acc evs (* should be assert false *)
    | Some ev ->
      let result, more_events = TacticWorker.handle_event ev in
      let evs = Sel.Todo.add evs more_events in
      match result with
      | None -> wait acc evs
      | Some(TacticJob.UpdateSolution(ev,TacticJob.Solved(c,u))) ->
          log @@ "got solution for evar " ^ Pp.string_of_ppcmds @@ Evar.print ev;
          wait acc evs
      | Some(TacticJob.AppendFeedback _) ->
          log @@ "got feedback";
          wait acc evs
      | Some(TacticJob.UpdateSolution(ev,TacticJob.NoProgress)) ->
          log @@ "got no progress for " ^ Pp.string_of_ppcmds @@ Evar.print ev;
          wait acc evs
      | Some(TacticJob.UpdateSolution(ev,TacticJob.Error err)) ->
          log @@ "got error for " ^ Pp.string_of_ppcmds @@ Evar.print ev;
          List.iter DelegationManager.cancel_job job_ids;
          CErrors.user_err err in
  let results = wait [] Sel.Todo.(add empty events) in
  Declare.Proof.map pstate ~f:(fun p ->
    let p,_,() = Proof.run_tactic (Global.env()) (assign_tac ~abstract results) p in
    p)
  [@@warning "-27"] (* FIXME: why are info and with_end_tac unused? *)

let () = ComTactic.set_par_implementation interp_par

module TacticWorkerProcess = struct
  type options = TacticWorker.options
  let parse_options = TacticWorker.parse_options
  let main ~st:initial_vernac_state options =
    let send_back, job = TacticWorker.setup_plumbing options in
    worker_solve_one_goal job ~send_back;
    exit 0
    [@@warning "-27"] (* FIXME: why is st unused? *)
  let log = TacticWorker.log
end

