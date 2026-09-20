# Legacy non-flake entry point (`nix-shell`); mirrors the flake's
# devShells.default. Keep the two in sync.
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
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
}
