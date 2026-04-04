{ description = "Tiled, scrollable window management for GNOME Shell";

  inputs =
  { "nixpkgs".url = "github:NixOS/nixpkgs";
    "nixpkgs-gnome".url = "github:NixOS/nixpkgs/wip-gnome";

    "gtk-stream".url = "git+https://git.sr.ht/~marc-coiffier/gtk-stream";
    "gtk-stream".flake = false;
  };

  outputs = { self, nixpkgs, nixpkgs-gnome, flake-utils, gtk-stream, ... }:
  let
    testSystem = "x86_64-linux";
    pkgs-gnome = import nixpkgs-gnome { system = testSystem; };
    gnomeOverlay = (s: super: {
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
    });

    # NixOS usually takes its sweet time updating to latest GNOME.
    # Enable this to use the GNOME version from their dedicated dev branch.
    #WARN: build times may increase significantly!
    useGnomeStaging = false;
  in
  flake-utils.lib.eachDefaultSystem
    (system:
    let hostPkgs = import nixpkgs { inherit system; };
    in
    { packages.default = hostPkgs.callPackage ./default.nix {};

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

      checks = import ./tests {
        system = testSystem;
        pkgs = import nixpkgs { system = testSystem; };
        defaultConfig = { pkgs, ... }: {
          imports = [ ./vm.nix ];
          nixpkgs.overlays = [
            (s: super: {
              paperwm = self.packages.${testSystem}.default;
              gtk-stream = s.callPackage gtk-stream {};
            })

            (if useGnomeStaging then gnomeOverlay else (s: super: {}))
          ];
        };
      };
    }) // {
      nixosConfigurations."testbox" =
        nixpkgs.lib.nixosSystem {
          system = testSystem;
          modules = [
            ./vm.nix
            { nixpkgs.overlays = [
                # Introduce PaperWM into our extensions
                (s: super: {
                  paperwm = self.packages.${testSystem}.default;
                  gtk-stream = s.callPackage gtk-stream {};
                })

                # Pull GNOME-specific packages from GNOME staging
                (if useGnomeStaging then gnomeOverlay else (s: super: {}))
              ];
            }
          ];
        };
    };
}
