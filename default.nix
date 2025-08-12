{ pkgs, stdenv, glib, ... }:

let
  uuid = "paperwm@paperwm.github.com";
in
stdenv.mkDerivation {
  pname = "gnome-shell-extension-paperwm";
  version = "unstable";
  src = ./.;

  makeFlags = [ "SOURCE=$(src)" "EXT_DIR=$(out)/share/gnome-shell/extensions" ];

  nativeBuildInputs = with pkgs;
    [ glib
    ];

  passthru = {
    extensionPortalSlug = "paperwm";
    extensionUuid = uuid;
  };
}
