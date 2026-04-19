{ pkgs, config, lib, ... }:

let
  cfg = config.testing;
in
{
options.testing = with lib; {
  ### Shorthand options to configure the VM for different test scenarios

  extraExtensions = mkOption {
    type = types.listOf (types.package);
    default = [];
    description = "Additional GNOME extensions to install";
  };

  extraWinprops = mkOption {
    type = types.listOf (types.attrs);
    default = [];
    description = "Additional PaperWM winprops to load";
  };

  extraConfig = mkOption {
    type = types.attrs;
    default = {};
    description = "Additional PaperWM configuration";
  };

  useCoverage = mkOption {
    type = types.bool;
    default = false;
    description = "Generate coverage data for this run";
  };
};

config = {
  ### Make PaperWM and test tools available in system environment
  environment.systemPackages = with pkgs;
  [ paperwm
    gtk-stream
    (lib.getBin libinput)

    gnomeExtensions.no-overview
  ] ++ cfg.extraExtensions;

  ### Set graphical session to auto-login GNOME
  services.displayManager = {
    gdm.enable = true;
    autoLogin =
    { enable = true;
      user = "user";
    };
  };
  services.desktopManager.gnome = {
    enable = true;
    debug = true;
  };

  ### Allow FIFOs to poke through cgroups, required for testing
  boot.kernel.sysctl = {
    "fs.protected_fifos" = 0;
  };

  systemd.user.services = let
    mkGtkStream = backend: {
      path = with pkgs; [ gtk-stream coreutils ];
      serviceConfig = {
        ExecStartPre = [
          "${pkgs.coreutils}/bin/mkfifo /tmp/app_%i"
        ];
        ExecStart = ["/bin/sh -c 'gtk-stream < /tmp/app_%i > /tmp/app_%i'"];
        Environment = [
          "GDK_BACKEND=wayland"
        ];
        ExecStop = ["${pkgs.coreutils}/bin/rm /tmp/app_%i"];
      };
      environment."GTK_BACKEND" = backend;
    };
  in {
    ### Enable unsafe mode by default
    "org.gnome.Shell@wayland" = {
      overrideStrategy = "asDropin";
      serviceConfig = {
        ExecStart = ["" "${pkgs.gnome-shell}/bin/gnome-shell --unsafe-mode"];
        Environment = lib.mkIf cfg.useCoverage [
          "GJS_COVERAGE_OUTPUT=/home/coverage"
          "GJS_COVERAGE_PREFIXES=${./.}"
        ];
      };
    };

    ### Let systemd manage the gtk-stream lifecycle
    "gtk-stream-wayland@" = mkGtkStream "wayland";
    "gtk-stream-x11@" = mkGtkStream "x11";
  };

  ### Set dconf to enable PaperWM out of the box
  programs.dconf =
  { enable = true;
    profiles."user".databases = [
      { settings =
        { "org/gnome/shell" =
          { enabled-extensions =
            [ "paperwm@paperwm.github.com"
              "no-overview@fthx"
            ] ++ map (ex: ex.extensionUuid) cfg.extraExtensions;
            disable-user-extensions = false;
          };
          "org/gnome/shell/extensions/paperwm" =
          { winprops =
            [ (builtins.toJSON {
                wm_class = "/^com.github.paperwm.scratch_app/i";
                scratch_layer = true;
              })
            ] ++ map builtins.toJSON cfg.extraWinprops;

            #NOTE: You can add more dconf settings to test with here!
          } // cfg.extraConfig;
        };
      }
    ];
  };

  ### Remove unnecessary dependencies
  #NOTE: This drops many GTK4 apps, re-enable if needed for testing.
  services.gnome.core-utilities.enable = false;

  ### Set default user
  users.users."user" =
  { isNormalUser = true;
    createHome = true;
    home = "/home";
    description = "PaperWM test user";
    extraGroups = [ "wheel" ];
    password = "paperwm";
  };

  ### No-password sudo
  security.sudo =
  { enable = true;
    extraConfig = "%wheel ALL=(ALL) NOPASSWD: ALL";
  };

  ### Switch to VirtIO emulated GPU
  virtualisation.qemu.options = [
    "-vga virtio"
  ];
};
}
