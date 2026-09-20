{ description = "Tiled, scrollable window management for GNOME Shell";

  inputs."nixpkgs".url = github:NixOS/nixpkgs;
  inputs."nixpkgs-gnome".url = github:vitorpavani/nixpkgs/gnome-50-bump;

  outputs = { self, nixpkgs, nixpkgs-gnome, flake-utils, ... }:
  flake-utils.lib.eachDefaultSystem
    (system:
    let hostPkgs = import nixpkgs { inherit system; };
    in
    { packages.default = hostPkgs.callPackage ./default.nix {};

      devShells.default = hostPkgs.mkShell {
        # Editor-facing tooling
        #   * vtsls - JS/TS language server
        #   * eslint - the project lints via .eslintrc.yml with no plugins,
        #     so the standalone nixpkgs eslint works without any npm setup.
        #   * glib - glib-compile-schemas for `make install`.
        #   * zip - the Makefile's release target.
        packages = with hostPkgs; [
          vtsls
          eslint
          nodejs
          glib
          zip
        ];

        shellHook = ''
          # ── Personal hook. Gitignored
          if [ -f ./.dev.local.sh ]; then
            # shellcheck source=/dev/null
            . ./.dev.local.sh
          fi
        '';
      };

      # This allows us to build Qemu for the host system thus avoiding
      # double emulation.
      packages.vm = let hostConfig = self.nixosConfigurations.testbox;
                        localConfig = hostConfig.extendModules {
                          modules = [
                            ({ modulesPath, ... }: {
                              imports = [ "${modulesPath}/virtualisation/qemu-vm.nix" ];
                              virtualisation.host.pkgs = hostPkgs;
                            })
                          ];
                        };
                     in localConfig.config.system.build.vm;
    }) // {
      nixosConfigurations."testbox" =
        let system = "x86_64-linux";
            pkgs-gnome = import nixpkgs-gnome { inherit system; };
        in nixpkgs.lib.nixosSystem {
          inherit system;
          modules = [
            ./vm.nix
            { nixpkgs.overlays = [
                # Introduce PaperWM into our extensions
                (s: super: { paperwm = self.packages.${system}.default; })

                # Pull GNOME-specific packages from GNOME staging
                (s: super: {
                  gnome-desktop = pkgs-gnome.gnome-desktop;
                  gnome-shell   = pkgs-gnome.gnome-shell.override {
                    evolution-data-server-gtk4 = super.evolution-data-server-gtk4.override {
                      inherit (super) webkitgtk_4_1 webkitgtk_6_0;
                    };
                  };
                  gnome-session = pkgs-gnome.gnome-session.override {
                    inherit (s) gnome-shell;
                  };
                  gnome-control-center = pkgs-gnome.gnome-control-center;
                  gnome-initial-setup = pkgs-gnome.gnome-initial-setup.override {
                    inherit (super) webkitgtk_6_0;
                  };
                  gnome-settings-daemon = pkgs-gnome.gnome-settings-daemon;
                  mutter        = pkgs-gnome.mutter;
                  gdm           = pkgs-gnome.gdm;
                  xdg-desktop-portal-gnome = pkgs-gnome.xdg-desktop-portal-gnome;
                  xdg-desktop-portal-gtk = pkgs-gnome.xdg-desktop-portal-gtk;
                })
              ];
            }
          ];
        };
    };
}
