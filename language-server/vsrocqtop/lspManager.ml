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

(** This toplevel implements an LSP-based server language for VsCode,
    used by the VsRocq extension. *)

open Printer
open Lsp.Types
open Protocol
open Protocol.LspWrapper
open Protocol.ExtProtocol
open Dm.Types

[%%if rocq = "8.18" || rocq = "8.19" || rocq = "8.20" || rocq = "9.0" || rocq = "9.1" || rocq = "9.2"]
module CompactedDecl = Context.Compacted.Declaration
[%%else]
module CompactedDecl = Ppconstr.CompactedDecl
[%%endif]

let init_state : Vernacstate.t option ref = ref None
let get_init_state () =
  match !init_state with
  | Some st -> st
  | None -> CErrors.anomaly Pp.(str "Initial state not available")

type tab = { st : Dm.DocumentManager.state; visible : bool }

let states : (string, tab) Hashtbl.t = Hashtbl.create 39

let max_memory_usage  = ref 4000000000

let full_diagnostics = ref false
let full_messages = ref false


let Dm.Types.Log log = Dm.Log.mk_log "lspManager"

let conf_request_id = max_int

let server_info = InitializeResult.create_serverInfo
  ~name:"vsrocq-language-server"
  ~version:"2.5.0"
  ()

type lsp_event = 
  | Receive of Jsonrpc.Packet.t option
  | Send of Jsonrpc.Packet.t

type event =
 | LspManagerEvent of lsp_event
 | DocumentManagerEvent of DocumentUri.t * Dm.DocumentManager.event
 | Notification of notification
 | LogEvent of Dm.Log.event

type events = event Sel.Event.t list

let lsp : event Sel.Event.t =
  Sel.On.httpcle ~priority:Dm.PriorityManager.lsp_message ~name:"lsp" Unix.stdin (function
    | Ok buff ->
      begin
        log (fun () -> "UI req ready");
        try LspManagerEvent (Receive (Some (Jsonrpc.Packet.t_of_yojson (Yojson.Safe.from_string (Bytes.to_string buff)))))
        with exn ->
          log (fun () -> "failed to decode json");
          LspManagerEvent (Receive None)
      end
    | Error exn ->
        log (fun () -> ("failed to read message: " ^ Printexc.to_string exn));
        (* do not remove this line otherwise the server stays running in some scenarios *)
        exit 0)


let output_json obj =
  let msg  = Yojson.Safe.to_string ~std:true obj in
  let size = String.length msg in
  let s = Printf.sprintf "Content-Length: %d\r\n\r\n%s" size msg in
  log (fun () -> "sent: " ^ Yojson.Safe.pretty_to_string ~std:true obj);
  ignore(Unix.write_substring Unix.stdout s 0 (String.length s)) (* TODO ERROR *)

let output_notification notif =
  output_json @@ Jsonrpc.Notification.yojson_of_t @@ Notification.Server.to_jsonrpc notif

let inject_dm_event uri x : event Sel.Event.t =
  Sel.Event.map (fun e -> DocumentManagerEvent(uri,e)) x

let inject_notification x : event Sel.Event.t =
  Sel.Event.map (fun x -> Notification(x)) x

let inject_debug_event x : event Sel.Event.t =
  Sel.Event.map (fun x -> LogEvent x) x

let inject_dm_events (uri,l) =
  List.map (inject_dm_event uri) l

let inject_notifications l =
  List.map inject_notification l

let inject_debug_events l =
  List.map inject_debug_event l

let do_configuration settings = 
  let open Settings in
  let open Dm.ExecutionManager in
  let delegation_mode =
    match settings.proof.delegation with
    | None     -> CheckProofsInMaster
    | Skip     -> SkipProofs
    | Delegate -> DelegateProofsToWorkers { number_of_workers = Option.get settings.proof.workers }
  in
  Dm.ExecutionManager.set_options {
    delegation_mode;
    completion_options = settings.completion;
    enableDiagnostics = settings.diagnostics.enable;
  };
  full_diagnostics := settings.diagnostics.full;
  full_messages := settings.goals.messages.full;
  max_memory_usage := settings.memory.limit * 1000000000;
  Dm.CheckingManager.set_options {
    Dm.CheckingManager.check_mode = settings.proof.mode;
    block_on_first_error = settings.proof.block;
    point_interp_mode = settings.proof.pointInterpretationMode;
    pp_mode = Option.default Settings.Goals.PrettyPrint.Pp settings.goals.ppmode;
    diff_mode = Settings.Goals.Diff.Mode.Off;
    preempt = settings.interrupt.preempt;
    (* Diff mode is broken, cfr #1163 #1164 *)
    (* diff_mode := settings.goals.diff.mode; *)
  }

let send_configuration_request () =
  let id = `Int conf_request_id in
  let mk_configuration_item section =
    ConfigurationItem.({ scopeUri = None; section = Some section })
  in
  let items = List.map mk_configuration_item ["vsrocq"] in
  let req = Lsp.Server_request.(to_jsonrpc_request (WorkspaceConfiguration { items }) ~id) in
  Send (Request req)

let do_initialize id params =
  let Lsp.Types.InitializeParams.{ initializationOptions } = params in
  begin match initializationOptions with
  | None -> log (fun () -> "Failed to decode initialization options")
  | Some initializationOptions ->
    do_configuration @@ Settings.t_of_yojson initializationOptions;
  end;
  let textDocumentSync = `TextDocumentSyncKind TextDocumentSyncKind.Incremental in
  let completionProvider = CompletionOptions.create ~resolveProvider:false () in
  let documentSymbolProvider = `DocumentSymbolOptions (DocumentSymbolOptions.create ~workDoneProgress:true ()) in
  let documentHighlightProvider = `Bool true in
  let hoverProvider = `Bool true in
  let definitionProvider = `Bool true in
  let foldingRangeProvider = `Bool true in
  let capabilities = ServerCapabilities.create
    ~textDocumentSync
    ~completionProvider
    ~hoverProvider
    ~definitionProvider
    ~documentSymbolProvider
    ~documentHighlightProvider
    ~foldingRangeProvider
  ()
  in
  let initialize_result = Lsp.Types.InitializeResult.{
    capabilities = capabilities; 
    serverInfo = Some server_info;
  } in
  log ~force:true (fun () -> "---------------- initialized --------------");
  let debug_events = Dm.Log.lsp_initialization_done () |> inject_debug_events in
  Ok initialize_result, debug_events@[Sel.now @@ LspManagerEvent (send_configuration_request ())]

let do_shutdown id params =
  Ok(()), []

let do_exit () =
  exit 0

let parse_loc json =
  let open Yojson.Safe.Util in
  let line = json |> member "line" |> to_int in
  let character = json |> member "character" |> to_int in
  Position.{ line ; character }

let publish_diagnostics uri doc =
  let diagnostics = Dm.DocumentManager.all_diagnostics doc in
  let diagnostics =
    if !full_diagnostics then diagnostics
    else List.filter (fun d -> d.Diagnostic.severity != Some DiagnosticSeverity.Information) diagnostics
  in
  let params = Lsp.Types.PublishDiagnosticsParams.create ~diagnostics ~uri () in
  let diag_notification = Lsp.Server_notification.PublishDiagnostics params in
  output_notification (Std diag_notification)

let send_highlights uri doc =
  let { Dm.Types.processing;  processed; prepared } =
    Dm.DocumentManager.executed_ranges doc in
  let notification = Notification.Server.UpdateHighlights {
    uri;
    preparedRange = prepared;
    processingRange = processing;
    processedRange = processed;
  }
  in
  output_json @@ Jsonrpc.Notification.yojson_of_t @@ Notification.Server.to_jsonrpc notification

let send_proof_view pv =
  log (fun () -> "-------------------------- sending proof view ---------------------------------------");
  let notification = Notification.Server.ProofView pv in
  output_json @@ Jsonrpc.Notification.yojson_of_t @@ Notification.Server.to_jsonrpc notification

let send_move_cursor uri range = 
  let notification = Notification.Server.MoveCursor {uri;range} in 
  output_notification notification

let send_block_on_error uri range = 
  let notification = Notification.Server.BlockOnError {uri;range} in 
  output_notification notification

let send_rocq_debug message =
  let notification = Notification.Server.RocqLogMessage {message} in
  output_notification notification

let send_error_notification message =
  let type_ = MessageType.Error in
  let params = ShowMessageParams.{type_; message} in
  let notification = Lsp.Server_notification.ShowMessage params in
  output_json @@ Jsonrpc.Notification.yojson_of_t @@ Lsp.Server_notification.to_jsonrpc notification

let update_view uri st =
  if (Dm.ExecutionManager.is_diagnostics_enabled ()) then (
    send_highlights uri st;
    publish_diagnostics uri st;
  )

let replace_state path st visible = Hashtbl.replace states path { st; visible}

(* Every handler that acts on a document starts by looking it up in [states].
   When the document is unknown the event is logged and dropped; what "dropped"
   means depends on the handler's return shape, hence the variants below. *)
let with_document_or ~default handler uri f =
  match Hashtbl.find_opt states (DocumentUri.to_path uri) with
  | None -> log (fun () -> "[" ^ handler ^ "] ignoring event on non existent document"); default
  | Some tab -> f tab

let document_does_not_exist = Error { message = "Document does not exist"; code = None }

(* For notification handlers: no events on an unknown document. *)
let with_document handler uri f = with_document_or ~default:[] handler uri f

(* For request handlers replying with a result and events. *)
let with_document_request handler uri f = with_document_or ~default:(document_does_not_exist, []) handler uri f

let log_notification method_ = log (fun () -> "Received notification: " ^ method_)

let run_documents () =
  let interpret_doc_in_bg path { st : Dm.DocumentManager.state ; visible } events =
      let st = Dm.DocumentManager.reset_to_top st in
      let (st, events') = Dm.DocumentManager.interpret_in_background st in
      let uri = DocumentUri.of_path path in
      replace_state path st visible;
      update_view uri st;
      let events' = inject_dm_events (uri, events') in
      events@events'
  in
  Hashtbl.fold interpret_doc_in_bg states []

let reset_observe_ids =
  let reset_doc_observe_id path {st : Dm.DocumentManager.state; visible} events =
    let st = Dm.DocumentManager.reset_to_top st in
    let uri = DocumentUri.of_path path in
    replace_state path st visible;
    update_view uri st
  in
  Hashtbl.fold reset_doc_observe_id states

[%%if rocq = "8.18" || rocq = "8.19" || rocq = "8.20"]
(* in these rocq versions init_runtime called globally for the process includes init_document
   this means in these versions we do not support local _CoqProject except for the effect on injections
   (eg -noinit) *)
let init_document _ vst = vst
[%%else]
let init_document local_args vst =
  let () = Vernacstate.unfreeze_full_state vst in
  let () = Coqinit.init_document local_args in
  Vernacstate.freeze_full_state ()
[%%endif]

let open_new_document uri text =
  let vst = get_init_state () in
  let fname = DocumentUri.to_path uri in
  let dir = Filename.dirname fname in
  let local_args = Args.get_local_args dir in
  let vst = init_document local_args vst in
  let st, events = try Dm.DocumentManager.init vst ~opts:(Coqargs.injection_commands local_args) uri ~text with
    e -> raise e
  in
  Hashtbl.add states (DocumentUri.to_path uri) { st ; visible = true; };
  update_view uri st;
  inject_dm_events (uri, events)

let textDocumentDidOpen params =
  let Lsp.Types.DidOpenTextDocumentParams.{ textDocument = { uri; text } } = params in
  match Hashtbl.find_opt states (DocumentUri.to_path uri) with
  | None -> open_new_document uri text
  | Some { st } -> update_view uri st; []
    (* let (st, events) = 
      if !check_mode = Settings.Mode.Continuous then
        let (st, events) = Dm.DocumentManager.interpret_in_background st ~should_block_on_error:!block_on_first_error in
        (st, events)
      else 
        (st, [])
    in
    update_view uri st;
    inject_dm_events (uri, events) *)

let textDocumentDidChange params =
  let Lsp.Types.DidChangeTextDocumentParams.{ textDocument; contentChanges } = params in
  let uri = textDocument.uri in
  with_document "textDocumentDidChange" uri (fun { st; visible } ->
    let mk_text_edit TextDocumentContentChangeEvent.{ range; text } =
      Option.get range, text
    in
    let text_edits = List.map mk_text_edit contentChanges in
    let st, events = Dm.DocumentManager.apply_text_edits st text_edits in
    replace_state (DocumentUri.to_path uri) st visible;
    update_view uri st;
    inject_dm_events (uri, events))

let current_memory_usage () =
  let { Gc.heap_words; _ } = Gc.stat () in
  Sys.word_size * heap_words

let purge_invisible_tabs () =
  Hashtbl.filter_map_inplace (fun u ({ visible } as v) ->
    if visible then Some v
    else begin
      log (fun () -> "purging tab " ^ u);
      None
    end)
  states

let consider_purge_invisible_tabs () =
  let usage = current_memory_usage () in
  if usage > !max_memory_usage (* 4G *) then begin
    purge_invisible_tabs ();
    let vst = get_init_state () in
    Vernacstate.unfreeze_full_state vst;
    Vernacstate.Interp.invalidate_cache ();
    Gc.compact ();
    let new_usage = current_memory_usage () in
    log (fun () -> Printf.sprintf  "memory footprint %d -> %d" usage new_usage);
  end

let textDocumentDidClose params =
  let Lsp.Types.DidCloseTextDocumentParams.{ textDocument } = params in
  let path = DocumentUri.to_path textDocument.uri in
  with_document_or ~default:() "textDocumentDidClose" textDocument.uri (fun { st } -> replace_state path st false);
  consider_purge_invisible_tabs ();
  [] (* TODO handle properly *)

let textDocumentHover id params = 
  let Lsp.Types.HoverParams.{ textDocument; position } = params in
  let open Yojson.Safe.Util in
  (* FIXME handle error case properly: an unknown document answers [Ok None] *)
  with_document_or ~default:(Ok None) "textDocumentHover" textDocument.uri (fun { st } ->
    match Dm.DocumentManager.hover st position with
    | Some contents -> Ok (Some (Hover.create ~contents:(`MarkupContent contents) ()))
    | _ -> Ok None (* FIXME handle error case properly *))

let textDocumentHighlight id params =
  let Lsp.Types.DocumentHighlightParams.{ textDocument; position } = params in
  let open Yojson.Safe.Util in
  (* FIXME handle error case properly: an unknown document answers [Ok None] *)
  with_document_or ~default:(Ok None) "textDocumentHighlight" textDocument.uri (fun { st } ->
    let ranges = Dm.DocumentManager.highlight st position in
    Ok (Some (List.map (fun range -> DocumentHighlight.create ~range:range ()) ranges)))

let textDocumentDefinition params =
  let Lsp.Types.DefinitionParams.{ textDocument; position } = params in
  (* FIXME handle error case properly: an unknown document answers [Ok None] *)
  with_document_or ~default:(Ok None) "textDocumentDefinition" textDocument.uri (fun { st } ->
    match Dm.DocumentManager.jump_to_definition st position with
    | None -> log (fun () -> "[textDocumentDefinition] could not find symbol location"); Ok None (* FIXME handle error case properly *)
    | Some (range, uri) ->
      let uri = DocumentUri.of_path uri in
      let location = Location.create ~range:range ~uri:uri in
      Ok (Some (`Location [location])))


let progress_hook uri () =
  with_document_or ~default:() "progress_hook" uri (fun { st } -> update_view uri st)

let rocqtopInterpretToPoint params =
  let Notification.Client.InterpretToPointParams.{ textDocument; position } = params in
  let uri = textDocument.uri in
  with_document "interpretToPoint" uri (fun { st; visible } ->
    let events = Dm.DocumentManager.interpret_to_position position in
    let sel_events = inject_dm_events (uri, events) in
    sel_events)
 
let rocqtopStepBackward params =
  let Notification.Client.StepBackwardParams.{ textDocument = { uri } } = params in
  with_document "stepBackward" uri (fun { st; visible } ->
    let events = Dm.DocumentManager.interpret_to_previous () in
    inject_dm_events (uri,events))

let rocqtopStepForward params =
  let Notification.Client.StepForwardParams.{ textDocument = { uri } } = params in
  with_document "stepForward" uri (fun { st; visible } ->
    let events = Dm.DocumentManager.interpret_to_next () in
    inject_dm_events (uri,events))

  let make_CompletionItem i item : CompletionItem.t = 
    let (label, insertText, typ, path) = Dm.CompletionItems.pp_completion_item item in
    CompletionItem.create
      ~label
      ~insertText
      ~detail:typ
      ~documentation:(`String ("Path: " ^ path))
      ~sortText:(Printf.sprintf "%5d" i)
      ?filterText:(if label == insertText then None else Some (insertText))
      ()

let textDocumentCompletion id params =
  let return_completion ~isIncomplete ~items =
    Ok (Some (`CompletionList (Lsp.Types.CompletionList.create ~isIncomplete ~items ())))
  in
  if not (Dm.ExecutionManager.get_options ()).completion_options.enable then
    return_completion ~isIncomplete:false ~items:[], []
  else
  let Lsp.Types.CompletionParams.{ textDocument = { uri }; position } = params in
  with_document_request "textDocumentCompletion" uri (fun { st } ->
    let items = List.mapi make_CompletionItem (Dm.DocumentManager.get_completions st position) in
    return_completion ~isIncomplete:false ~items, [])

let documentFoldingRange id params =
  let Lsp.Types.FoldingRangeParams.{ textDocument = { uri } } = params in
  with_document_or ~default:document_does_not_exist "documentFoldingRange" uri (fun { st } ->
    log (fun () -> "[documentFoldingRange] getting folding ranges");
    if Dm.DocumentManager.is_parsing st then
      Error {code=(Some Jsonrpc.Response.Error.Code.ServerCancelled); message="Parsing not finished"}
    else
      let folding_ranges = Dm.DocumentManager.get_folding_ranges st in
      Ok(Some folding_ranges))

let documentSymbol id params =
  let Lsp.Types.DocumentSymbolParams.{ textDocument = {uri}; partialResultToken; workDoneToken } = params in (*TODO: At some point we might get support for partialResult and workDone*)
  with_document_request "documentSymbol" uri (fun tab -> log (fun () -> "[documentSymbol] getting symbols");
    if Dm.DocumentManager.is_parsing tab.st then
       (* Making use of the error codes: the ServerCancelled error code indicates 
       that the server is busy and the client should resend the request later.
       It doesn't seem to be working for documentSymbol at the moment. *)
      Error {code=(Some Jsonrpc.Response.Error.Code.ServerCancelled); message="Parsing not finished"} , []
    else
      let symbols = Dm.DocumentManager.get_document_symbols tab.st in
      Ok(Some (`DocumentSymbol symbols)), [])

let rocqtopResetRocq id params =
  let Request.Client.ResetParams.{ textDocument = { uri } } = params in
  with_document_request "resetRocq" uri (fun { st; visible } ->
    let st, events = Dm.DocumentManager.reset st in
    replace_state (DocumentUri.to_path uri) st visible;
    update_view uri st;
    Ok(()), (uri,events) |> inject_dm_events)

let rocqtopInterpretToEnd params =
  let Notification.Client.InterpretToEndParams.{ textDocument = { uri } } = params in
  with_document "interpretToEnd" uri (fun { st; visible } ->
    let events = Dm.DocumentManager.interpret_to_end () in
    inject_dm_events (uri,events))

let rocqtopLocate id params = 
  let Request.Client.LocateParams.{ textDocument = { uri }; position; pattern } = params in
  with_document_request "locate" uri (fun { st } ->
    Dm.DocumentManager.locate st position ~pattern, [])

let rocqtopPrint id params = 
  let Request.Client.PrintParams.{ textDocument = { uri }; position; pattern } = params in
  with_document_request "print" uri (fun { st } -> Dm.DocumentManager.print st position ~pattern, [])

let rocqtopAbout id params =
  let Request.Client.AboutParams.{ textDocument = { uri }; position; pattern } = params in
  with_document_request "about" uri (fun { st } -> Dm.DocumentManager.about st position ~pattern, [])

let rocqtopCheck id params =
  let Request.Client.CheckParams.{ textDocument = { uri }; position; pattern } = params in
  with_document_request "check" uri (fun { st } -> Dm.DocumentManager.check st position ~pattern, [])

let rocqtopSearch id params =
  let Request.Client.SearchParams.{ textDocument = { uri }; id; position; pattern } = params in
  with_document_request "search" uri (fun { st } ->
    try
      let notifications = Dm.DocumentManager.search st ~id position pattern in
      Ok(()), inject_notifications notifications
    with e ->
      let e, info = Exninfo.capture e in
      let message = Pp.string_of_ppcmds @@ CErrors.iprint (e, info) in
      Error({message; code=None}), [])

let sendDocumentState id params = 
  let Request.Client.DocumentStateParams.{ textDocument } = params in
  let uri = textDocument.uri in
  with_document_request "documentState" uri (fun { st } ->
    let document = Dm.DocumentManager.Internal.string_of_state st in
    Ok Request.Client.DocumentStateResult.{ document }, [])

let sendDocumentProofs id params = 
  let Request.Client.DocumentProofsParams.{ textDocument } = params in
  let uri = textDocument.uri in
  with_document_request "documentProofs" uri (fun { st } ->
    if Dm.DocumentManager.is_parsing st then
      Error {code=(Some Jsonrpc.Response.Error.Code.ServerCancelled); message="Parsing not finished"} , []
    else
      let proofs = Dm.DocumentManager.get_document_proofs st in
      Ok Request.Client.DocumentProofsResult.{ proofs }, [])

let workspaceDidChangeConfiguration params = 
  let Lsp.Types.DidChangeConfigurationParams.{ settings } = params in
  let settings = Settings.t_of_yojson settings in
  do_configuration settings;
  match settings.proof.mode with
  | Continuous -> run_documents ()
  | Manual -> reset_observe_ids (); ([] : events)

let handle_interrupt params =
  let Notification.Client.InterruptParams.{ textDocument } = params in
  let uri = textDocument.uri in
  with_document "interrupt" uri (fun { st } -> Dm.DocumentManager.interrupt_execution st; [])

let dispatch_std_request : type a. Jsonrpc.Id.t -> a Lsp.Client_request.t -> (a, error) result * events =
  fun id req ->
  match req with
  | Initialize params ->
    do_initialize id params
  | Shutdown ->
    do_shutdown id ()
  | TextDocumentCompletion params ->
    textDocumentCompletion id params
  | TextDocumentDefinition params ->
    textDocumentDefinition params, []
  | TextDocumentHover params ->
    textDocumentHover id params, []
  | TextDocumentHighlight params ->
    textDocumentHighlight id params, []
  | DocumentSymbol params ->
    documentSymbol id params
  | TextDocumentFoldingRange params ->
    documentFoldingRange id params, []
  | UnknownRequest _ | _  -> Error ({message="Received unknown request"; code=None}), []

let dispatch_request : type a. Jsonrpc.Id.t -> a Request.Client.t -> (a,error) result * events =
  fun id req ->
  match req with
  | Std req -> dispatch_std_request id req
  | Reset params -> rocqtopResetRocq id params
  | About params -> rocqtopAbout id params
  | Check params -> rocqtopCheck id params
  | Locate params -> rocqtopLocate id params
  | Print params -> rocqtopPrint id params
  | Search params -> rocqtopSearch id params
  | DocumentState params -> sendDocumentState id params
  | DocumentProofs params -> sendDocumentProofs id params

let dispatch_std_notification = 
  let open Lsp.Client_notification in function
  | TextDocumentDidOpen params -> log_notification "textDocument/didOpen";
    begin try textDocumentDidOpen params with
      exn -> let info = Exninfo.capture exn in
      let message = "Error while opening document. " ^ Pp.string_of_ppcmds @@ CErrors.iprint_no_report info in
      send_error_notification message; []
    end
  | TextDocumentDidChange params -> log_notification "textDocument/didChange";
    textDocumentDidChange params
  | TextDocumentDidClose params -> log_notification "textDocument/didClose";
    textDocumentDidClose params
  | ChangeConfiguration params -> log_notification "workspace/didChangeConfiguration";
    workspaceDidChangeConfiguration params
  | Initialized -> []
  | Exit ->
    do_exit ()
  | UnknownNotification _ | _ -> log (fun () -> "Received unknown notification"); []

let dispatch_notification =
  let open Notification.Client in function
  | InterpretToPoint params -> log_notification "prover/interpretToPoint"; rocqtopInterpretToPoint params
  | InterpretToEnd params -> log_notification "prover/interpretToEnd"; rocqtopInterpretToEnd params
  | StepBackward params -> log_notification "prover/stepBackward"; rocqtopStepBackward params
  | StepForward params -> log_notification "prover/stepForward"; rocqtopStepForward params
  | Interrupt params -> log_notification "prover/interrupt"; handle_interrupt params
  | Std notif -> dispatch_std_notification notif

let handle_lsp_event = function
  | Receive None -> [lsp]
  | Receive (Some rpc) ->
    lsp :: (* the event is recurrent *)
    begin try
      let json = Jsonrpc.Packet.yojson_of_t rpc in
      log (fun () -> "received: " ^ Yojson.Safe.pretty_to_string ~std:true json);
      begin match rpc with
      | Request req ->
          log (fun () -> "ui request: " ^ req.method_);
          begin match Request.Client.t_of_jsonrpc req with
          | Error(e) -> log (fun () -> "Error decoding request: " ^ e); []
          | Ok(Pack r) ->
            let resp, events = dispatch_request req.id r in
            begin match resp with
            | Error {code; message} ->
              let code = Option.default Jsonrpc.Response.Error.Code.RequestFailed code in
              output_json @@ Jsonrpc.Response.(yojson_of_t @@ error req.id (Error.make ~code ~message ()))
            | Ok resp ->
              let resp = Request.Client.yojson_of_result r resp in
              output_json @@ Jsonrpc.Response.(yojson_of_t @@ ok req.id resp)
            end;
            events
          end
      | Notification notif ->
        begin match Notification.Client.of_jsonrpc notif with
        | Ok notif -> dispatch_notification notif
        | Error e -> log (fun () -> "error decoding notification: " ^ e); []
        end
      | Response resp ->
          log (fun () -> "got unknown response");
          []
      | Batch_response _ -> log (fun () -> "Unsupported batch response received"); []
      | Batch_call _ -> log (fun () -> "Unsupported batch call received"); []
      end
    with Ppx_yojson_conv_lib__Yojson_conv.Of_yojson_error(exn,json) ->
      log (fun () -> "error parsing json: " ^ Yojson.Safe.pretty_to_string json);
      []
    end
  | Send jsonrpc ->
    output_json (Jsonrpc.Packet.yojson_of_t jsonrpc); []

let pr_lsp_event fmt = function
  | Receive jsonrpc ->
    Format.fprintf fmt "Request"
  | Send jsonrpc ->
    Format.fprintf fmt "Send"

let handle_event = function
  | LspManagerEvent e -> handle_lsp_event e
  | DocumentManagerEvent (uri, e) ->
    with_document "handle_event" uri (fun { st; visible } ->
      let handled_event = Dm.DocumentManager.handle_event e st in
      let events = handled_event.events in
      begin match handled_event.state with
        | None -> ()
        | Some st ->
          replace_state (DocumentUri.to_path uri) st visible;
          if handled_event.update_view then update_view uri st
      end;
      Option.iter output_notification handled_event.notification;
      inject_dm_events (uri, events))
  | Notification notification ->
    begin match notification with 
    | QueryResultNotification params ->
      output_notification @@ SearchResult params; [inject_notification Dm.SearchQuery.query_feedback]
    end
  | LogEvent e ->
    send_rocq_debug e; [inject_debug_event Dm.Log.debug]

let pr_event fmt = function
  | LspManagerEvent e -> pr_lsp_event fmt e
  | DocumentManagerEvent (uri, e) ->
    Format.fprintf fmt "%a" Dm.DocumentManager.pp_event e
  | Notification _ -> Format.fprintf fmt "notif"
  | LogEvent _ -> Format.fprintf fmt "debug"

let init () =
  init_state := Some (Vernacstate.freeze_full_state ());
  [lsp]
