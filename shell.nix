with import <nixpkgs> {};

runCommand "shell" {
buildInputs = [ glib ];
} ""

