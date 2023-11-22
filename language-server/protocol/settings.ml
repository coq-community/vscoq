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

module DelegationMode = struct

type t = 
  | None
  | Skip 
  | Delegate 

let yojson_of_t = function
| None -> `String "None"
| Skip -> `String "Skip"
| Delegate -> `String "Delegate"

let t_of_yojson = function
| `String "None" -> None
| `String "Skip" -> Skip
| `String "Delegate" -> Delegate
| _ -> Yojson.json_error "invalid value"

end

module Mode = struct

  type t =
  | Continuous 
  | Manual
  | SemiContinuous
  [@@deriving yojson]
    
  let yojson_of_t = function
  | Manual -> `Int 0
  | Continuous -> `Int 1
  | SemiContinuous -> `Int 2

  let t_of_yojson = function
  | `Int 0 -> Manual
  | `Int 1 -> Continuous
  | `Int 2 -> SemiContinuous
  | _ -> Yojson.json_error @@ "invalid value "

end

module Proof = struct

  type t = {
    delegation: DelegationMode.t;
    workers: int option;
    mode: Mode.t;
  } [@@deriving yojson] [@@yojson.allow_extra_fields]

end

module Goals = struct

  module Messages = struct

    type t = {
      full : bool;
    } [@@deriving yojson]

  end

  module Diff = struct

    module Mode = struct

      type t = On | Off | Removed

      let t_of_yojson = function
      | `String "on" -> On
      | `String "off" -> Off
      | `String "removed" -> Removed
      | _ -> Yojson.json_error "invalid value "

      let yojson_of_t = function
      | On -> `String "on"
      | Off -> `String "off"
      | Removed -> `String "removed"

    end

    type t = {
      mode: Mode.t;
    } [@@deriving yojson] [@@yojson.allow_extra_fields]

  end

  type t = {
    diff: Diff.t;
    messages: Messages.t;
  } [@@deriving yojson] [@@yojson.allow_extra_fields]

end

module Completion = struct
  
  module RankingAlgoritm = struct

    type t = 
    | SplitTypeIntersection
    | StructuredSplitUnification
  
    let yojson_of_t = function  
    | SplitTypeIntersection -> `Int 0
    | StructuredSplitUnification -> `Int 1
  
    let t_of_yojson = function
    | `Int 0 -> SplitTypeIntersection
    | `Int 1 -> StructuredSplitUnification
    | _ -> Yojson.json_error @@ "invalid value "
  
  end

  type t = {
    enable: bool;
    algorithm: RankingAlgoritm.t;
    unificationLimit: int;
    atomicFactor: float [@default 5.]; (** Controls how highly specific types are prioritised over generics *)
    sizeFactor: float [@default 5.]; (** Controls how highly small types are prioritised over larger ones *)
  } [@@deriving yojson] [@@yojson.allow_extra_fields]

end

module Diagnostics = struct

  type t = {
    enable: bool [@default true]; (** Sets whether diagnostics like errors and highlighting are sent to the client at all. *)
    full: bool;
  } [@@deriving yojson]

end

type t = {
  proof: Proof.t;
  goals: Goals.t;
  completion: Completion.t;
  diagnostics: Diagnostics.t;
} [@@deriving yojson] [@@yojson.allow_extra_fields]