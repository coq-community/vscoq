{
  description = "VsCoq 2, a language server for Coq based on LSP";

  inputs = {

    flake-utils.url = "github:numtide/flake-utils";

    coq-master = { url = "github:rtetley/coq/4d99b9ea6c75d6cfaf6db3112b684169baea96df"; }; # Should be kept in sync with PIN_COQ in CI workflow
    coq-master.inputs.nixpkgs.follows = "nixpkgs";

  };

  outputs = { self, nixpkgs, flake-utils, coq-master }:
    flake-utils.lib.eachDefaultSystem (system:
  
   let vscoq_version = "2.1.2"; in
   let coq = coq-master.packages.${system}; in
   rec {

    packages.default = self.packages.${system}.vscoq-language-server-coq-8-19;

    packages.vscoq-language-server-coq-8-18 =
      # Notice the reference to nixpkgs here.
      with import nixpkgs { inherit system; };
      let ocamlPackages = ocaml-ng.ocamlPackages_4_14; in

      ocamlPackages.buildDunePackage {
        duneVersion = "3";
        pname = "vscoq-language-server";
        version = vscoq_version;
        src = ./language-server;
        nativeBuildInputs = [
          coq_8_18
        ];
        buildInputs = [
          coq_8_18
          dune_3
        ] ++ (with coq.ocamlPackages; [
          lablgtk3-sourceview3
          glib
          gnome.adwaita-icon-theme
          wrapGAppsHook
          ocaml
          yojson
          zarith
          findlib
          ppx_inline_test
          ppx_assert
          ppx_sexp_conv
          ppx_deriving
          ppx_optcomp
          ppx_import
          sexplib
          ppx_yojson_conv
          lsp
          sel
        ]);
      };

      packages.vscoq-language-server-coq-8-19 =
      # Notice the reference to nixpkgs here.
      with import nixpkgs { inherit system; };
      let ocamlPackages = ocaml-ng.ocamlPackages_4_14; in
      ocamlPackages.buildDunePackage {
        duneVersion = "3";
        pname = "vscoq-language-server";
        version = vscoq_version;
        src = ./language-server;
        nativeBuildInputs = [
          coq_8_19
        ];
        buildInputs = [
          coq_8_19
          dune_3
        ] ++ (with coq.ocamlPackages; [
          lablgtk3-sourceview3
          glib
          gnome.adwaita-icon-theme
          wrapGAppsHook
          ocaml
          yojson
          zarith
          findlib
          ppx_inline_test
          ppx_assert
          ppx_sexp_conv
          ppx_deriving
          ppx_optcomp
          ppx_import
          sexplib
          ppx_yojson_conv
          lsp
          sel
        ]);
      };

    packages.vscoq-language-server-coq-master =
      # Notice the reference to nixpkgs here.
      with import nixpkgs { inherit system; };
      let ocamlPackages = ocaml-ng.ocamlPackages_4_14; in
      ocamlPackages.buildDunePackage {
        duneVersion = "3";
        pname = "vscoq-language-server";
        version = vscoq_version;
        src = ./language-server;
        nativeBuildInputs = [
          coq
        ];
        buildInputs = [
          coq
          dune_3
        ] ++ (with coq.ocamlPackages; [
          lablgtk3-sourceview3
          glib
          gnome.adwaita-icon-theme
          wrapGAppsHook
          ocaml
          yojson
          zarith
          findlib
          ppx_inline_test
          ppx_assert
          ppx_sexp_conv
          ppx_deriving
          ppx_optcomp
          ppx_import
          sexplib
          ppx_yojson_conv
          lsp
          sel
        ]);
      };

    packages.vscoq-client =
      with import nixpkgs { inherit system; };

      let yarn_deps = (name: (path: (mkYarnModules {
        pname = "${name}_yarn_deps";
        version = vscoq_version;
        packageJSON = ./${path}/package.json;
        yarnLock = ./${path}/yarn.lock;
        yarnNix = ./${path}/yarn.nix;
      }))); in

      let client_deps = yarn_deps "client" /client; in
      let goal_view_ui_deps = yarn_deps "goal_ui" /client/goal-view-ui; in
      let search_ui_deps = yarn_deps "search_ui" /client/search-ui; in
      let link_deps = (x: (p: (''
        ln -s ${x}/node_modules ${p}
        export PATH=${x}/node_modules/.bin:$PATH
      ''))); in
      let links = [
        (link_deps client_deps ".")
        (link_deps goal_view_ui_deps "./goal-view-ui")
        (link_deps search_ui_deps "./search-ui")
      ]; in
      let cmds = builtins.concatStringsSep "\n" links; in

      stdenv.mkDerivation rec {

        name = "vscoq-client";
        src = ./client;

        nativeBuildInputs = [
          nodejs
          yarn
        ] ++ [client_deps goal_view_ui_deps search_ui_deps];

        buildPhase = cmds + ''
          cd goal-view-ui
          yarn run build
          cd ../search-ui
          yarn run build
          cd ..
          webpack --mode=production --devtool hidden-source-map
          bash -c "yes y | vsce package"
          mv *.vsix vscoq-client.vsix
          mkdir -p $out/bin
          cp ./vscoq-client.vsix $out/bin
        '';

    };

    devShells.vscoq-client = 
      with import nixpkgs { inherit system; };
      mkShell {
        buildInputs = self.packages.${system}.vscoq-client.buildInputs;
      };

    devShells.vscoq-language-server-coq-8-18 = 
        with import nixpkgs { inherit system; };
        let ocamlPackages = ocaml-ng.ocamlPackages_4_14; in
        mkShell {
            buildInputs =
            self.packages.${system}.vscoq-language-server-coq-8-18.buildInputs;
        };
        
    devShells.vscoq-language-server-coq-8-19 = 
      with import nixpkgs { inherit system; };
      let ocamlPackages = ocaml-ng.ocamlPackages_4_14; in
      mkShell {
        buildInputs =
          self.packages.${system}.vscoq-language-server-coq-8-19.buildInputs;
      };
    
    devShells.vscoq-language-server-coq-master = 
      with import nixpkgs { inherit system; };
      let ocamlPackages = ocaml-ng.ocamlPackages_4_14; in
      mkShell {
        buildInputs =
          self.packages.${system}.vscoq-language-server-coq-master.buildInputs
          ++ (with ocamlPackages; [
            ocaml-lsp
          ]);
      };

    devShells.default = 
      with import nixpkgs { inherit system; };
      let ocamlPackages = ocaml-ng.ocamlPackages_4_14; in
      mkShell {
        buildInputs =
          self.packages.${system}.vscoq-language-server-coq-8-19.buildInputs
          ++ (with ocamlPackages; [
            ocaml-lsp
          ]);
      };

  });
}
