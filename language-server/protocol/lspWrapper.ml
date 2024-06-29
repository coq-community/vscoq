(**************************************************************************)
(*                                                                        *)
(*                                 VSCoq                                  *)
(*                                                                        *)
(*                   Copyright INRIA and contributors                     *)
(*       (see version control and README file for authors & dates)Variables A : Type.        *)
(*                                                                        *)
(**************************************************************************)
(*                                                                        *)
(*   This file is distributed under the terms of the MIT License.         *)
(*   See LICENSE file.                                                    *)
(*                                                                        *)
(**************************************************************************)
open Lsp.Types
open Sexplib.Std
open Printing

module Position = struct

  include Lsp.Types.Position

  type t = [%import: Lsp.Types.Position.t] [@@deriving sexp]
 
  let compare pos1 pos2 =
    match Int.compare pos1.line pos2.line with
    | 0 -> Int.compare pos1.character pos2.character
    | x -> x

  let to_string pos = Format.sprintf "(%i,%i)" pos.line pos.character

end

module Range = struct

  include Lsp.Types.Range

  type t = [%import: Lsp.Types.Range.t] [@@deriving sexp]
  
  let compare r1 r2 =
    match Position.compare r1.start r2.start with
    | 0 -> Position.compare r1.end_ r2.end_
    | x -> x

  let equals r1 r2 =
    Position.compare r1.start r2.start == 0 && Position.compare r1.end_ r2.end_ == 0

  let included ~in_ { start; end_ } =
    let (<=) x y = Position.compare x y <= 0 in
    in_.start <= start && end_ <= in_.end_

  let strictly_included ~in_ { start; end_ } =
    let (<) x y = Position.compare x y < 0 in
    in_.start < start && end_ < in_.end_

  let prefixes ~in_ { start; end_ } =
    let (<) x y = Position.compare x y < 0 in
    let (<=) x y = Position.compare x y <= 0 in
    start <= in_.start && end_ < in_.end_ && in_.start <= end_

  let postfixes ~in_ { start; end_ } =
    let (<) x y = Position.compare x y < 0 in
    let (<=) x y = Position.compare x y <= 0 in
    start <= in_.end_ && in_.start < start && in_.end_ < end_

  let to_string range = Format.sprintf ("Range (start: %s, end: %s)") (Position.to_string range.start) (Position.to_string range.end_)

end 

module QuickFixData = struct
  type t = {text: string; range: Range.t} [@@deriving yojson]
end 

module DiagnosticSeverity = struct

  type t = [%import: Lsp.Types.DiagnosticSeverity.t] [@@deriving sexp]

  let yojson_of_t v = Lsp.Types.DiagnosticSeverity.yojson_of_t v
  let t_of_yojson v = Lsp.Types.DiagnosticSeverity.t_of_yojson v

  let of_feedback_level = let open DiagnosticSeverity in function
    | Feedback.Error -> Error
    | Feedback.Warning -> Warning
    | Feedback.(Info | Debug | Notice) -> Information

end

module FeedbackChannel = struct

  type t = 
  | Debug 
  | Info
  | Notice
  [@@deriving sexp, yojson]

  let yojson_of_t = function
  | Debug -> `Int 0
  | Info -> `Int 1
  | Notice -> `Int 2

  let t_of_feedback_level = function 
  | Feedback.Debug -> Some Debug
  | Feedback.Info -> Some Info 
  | Feedback.Notice -> Some Notice 
  | Feedback.(Error | Warning) -> None

end

module CoqFeedback = struct 

  type t = {
    range: Range.t; 
    message: string; 
    channel: FeedbackChannel.t;
  } [@@deriving sexp, yojson]
  
end

type query_result =
  { id : string;
    name : pp;
    statement : pp;
  } [@@deriving yojson]

type overview = {
  uri : DocumentUri.t;
  preparedRange: Range.t list;
  processingRange : Range.t list;
  processedRange : Range.t list;
} [@@deriving yojson]

type notification =
  | QueryResultNotification of query_result