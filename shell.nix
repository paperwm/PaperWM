{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    vtsls
    eslint
    nodejs
    glib
    zip
  ];

}
