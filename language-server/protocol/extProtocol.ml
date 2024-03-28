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
open Lsp.Types
open LspWrapper
open Printing

module Notification = struct

  module Client = struct

    module InterpretToPointParams = struct

      type t = {
        textDocument : VersionedTextDocumentIdentifier.t;
        position : Position.t;
      } [@@deriving yojson]

    end

    module InterpretToEndParams = struct

      type t = {
        textDocument : VersionedTextDocumentIdentifier.t;
      } [@@deriving yojson]

    end

    module StepBackwardParams = struct

      type t = {
        textDocument : VersionedTextDocumentIdentifier.t;
        position: Position.t option;
      } [@@deriving yojson]

    end

    module StepForwardParams = struct

      type t = {
        textDocument : VersionedTextDocumentIdentifier.t;
        position: Position.t option;
      } [@@deriving yojson]

    end

    type t =
    | Std of Lsp.Client_notification.t
    | InterpretToEnd of InterpretToEndParams.t
    | InterpretToPoint of InterpretToPointParams.t
    | StepForward of StepForwardParams.t
    | StepBackward of StepBackwardParams.t

    let of_jsonrpc (Jsonrpc.Notification.{ method_; params } as notif) =
      let open Lsp.Import.Result.O in
      match method_ with
      | "vscoq/interpretToPoint" ->
        let+ params = Lsp.Import.Json.message_params params InterpretToPointParams.t_of_yojson in
        InterpretToPoint params
      | "vscoq/stepBackward" ->
        let+ params = Lsp.Import.Json.message_params params StepBackwardParams.t_of_yojson in
        StepBackward params
      | "vscoq/stepForward" ->
        let+ params = Lsp.Import.Json.message_params params StepForwardParams.t_of_yojson in
        StepForward params
      | "vscoq/interpretToEnd" ->
        let+ params = Lsp.Import.Json.message_params params InterpretToEndParams.t_of_yojson in
        InterpretToEnd params
      | _ ->
        let+ notif = Lsp.Client_notification.of_jsonrpc notif in
        Std notif 

  end

  module Server = struct

    module MoveCursorParams = struct
      
      type t = {
        uri: DocumentUri.t; 
        range: Range.t;
      } [@@deriving yojson]

    end

    module ProofViewParams = struct

      type t = {
        proof: ProofState.t option;
        messages: (DiagnosticSeverity.t * pp) list;
      } [@@deriving yojson]

    end

    type t =
    | Std of Lsp.Server_notification.t
    | UpdateHighlights of overview
    | MoveCursor of MoveCursorParams.t
    | ProofView of ProofViewParams.t
    | SearchResult of query_result

    let to_jsonrpc = function
      | Std notification ->
        Lsp.Server_notification.to_jsonrpc notification
      | UpdateHighlights params ->
        let method_ = "vscoq/updateHighlights" in
        let params = yojson_of_overview params in
        let params = Some (Jsonrpc.Structured.t_of_yojson params) in
        Jsonrpc.Notification.{ method_; params }
      | ProofView params -> 
        let method_ = "vscoq/proofView" in
        let params = ProofViewParams.yojson_of_t params in
        let params = Some (Jsonrpc.Structured.t_of_yojson params) in
        Jsonrpc.Notification.{ method_; params }
      | SearchResult params ->
        let method_ = "vscoq/searchResult" in
        let params = yojson_of_query_result params in
        let params = Some (Jsonrpc.Structured.t_of_yojson params) in
        Jsonrpc.Notification.{ method_; params }      
      | MoveCursor params -> 
        let method_ = "vscoq/moveCursor" in 
        let params = MoveCursorParams.yojson_of_t params in 
        let params = Some (Jsonrpc.Structured.t_of_yojson params) in
        Jsonrpc.Notification.{ method_; params }   

    end

end

module Request = struct

  module Client = struct

  module ResetParams = struct

    type t = {
      textDocument : TextDocumentIdentifier.t;
    } [@@deriving yojson]

  end

  module AboutParams = struct

    type t = {
      textDocument : VersionedTextDocumentIdentifier.t;
      position : Position.t;
      pattern : string;
    } [@@deriving yojson]

  end

  module CheckParams = struct

    type t = {
      textDocument : VersionedTextDocumentIdentifier.t;
      position : Position.t;
      pattern : string;
    } [@@deriving yojson]

  end

  module LocateParams = struct

    type t = {
      textDocument : VersionedTextDocumentIdentifier.t;
      position : Position.t;
      pattern : string;
    } [@@deriving yojson]

  end

  module PrintParams = struct

    type t = {
      textDocument : VersionedTextDocumentIdentifier.t;
      position : Position.t;
      pattern : string;
    } [@@deriving yojson]

  end

  module SearchParams = struct

    type t = {
      textDocument : VersionedTextDocumentIdentifier.t;
      position : Position.t;
      pattern : string;
      id : string;
    } [@@deriving yojson]

  end

  module DocumentStateParams = struct 

    type t = {
      textDocument : TextDocumentIdentifier.t;
    } [@@deriving yojson]

  end

  module DocumentStateResult = struct
    
    type t = {
      document : string;
    } [@@deriving yojson]

  end

  type 'a t =
  | Std : 'a Lsp.Client_request.t -> 'a t
  | Reset : ResetParams.t -> unit t
  | About : AboutParams.t -> pp t
  | Check : CheckParams.t -> pp t
  | Locate : LocateParams.t -> pp t
  | Print : PrintParams.t -> pp t
  | Search : SearchParams.t -> unit t
  | DocumentState : DocumentStateParams.t -> DocumentStateResult.t t

  type packed = Pack : 'a t -> packed

  let t_of_jsonrpc (Jsonrpc.Request.{ method_; params } as req) =
    let open Lsp.Import.Result.O in
    match method_ with
    | "vscoq/resetCoq" ->
      let+ params = Lsp.Import.Json.message_params params ResetParams.t_of_yojson in
      Pack (Reset params)
    | "vscoq/search" ->
      let+ params = Lsp.Import.Json.message_params params SearchParams.t_of_yojson in
      Pack (Search params)
    | "vscoq/about" ->
      let+ params = Lsp.Import.Json.message_params params AboutParams.t_of_yojson in
      Pack (About params)
    | "vscoq/check" ->
      let+ params = Lsp.Import.Json.message_params params CheckParams.t_of_yojson in
      Pack (Check params)
    | "vscoq/locate" ->
      let+ params = Lsp.Import.Json.message_params params LocateParams.t_of_yojson in
      Pack (Locate params)
    | "vscoq/print" ->
      let+ params = Lsp.Import.Json.message_params params PrintParams.t_of_yojson in
      Pack (Print params)
    | "vscoq/documentState" ->
      let+ params = Lsp.Import.Json.message_params params DocumentStateParams.t_of_yojson in
      Pack (DocumentState params)
    | _ ->
      let+ E req = Lsp.Client_request.of_jsonrpc req in
      Pack (Std req)

  let yojson_of_result : type a. a t -> a -> Yojson.Safe.t =
    fun req resp ->
      match req with
      | Reset _ -> yojson_of_unit resp
      | About _ -> yojson_of_pp resp
      | Check _ -> yojson_of_pp resp
      | Locate _ -> yojson_of_pp resp
      | Print _ -> yojson_of_pp resp
      | Search _ -> yojson_of_unit resp
      | DocumentState _ -> DocumentStateResult.(yojson_of_t resp)
      | Std req -> Lsp.Client_request.yojson_of_result req resp

  end

end