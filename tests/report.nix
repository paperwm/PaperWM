{ pkgs, lib, stdenv, allure, emptyDirectory
  # A NixOS Behave test (with a .driver output) to run
, test
, ...}:

stdenv.mkDerivation {
  name = "${test.name}-report";
  src = emptyDirectory;

  nativeBuildInputs = [
    allure
  ];

  buildPhase = ''
    ${lib.getExe test.driver} || true
  '';

  installPhase = ''
    mkdir -p $out
    allure generate allure_output -o $out
  '';
}
