#!/bin/sh

# Creates a zip of (only) the necessary files required by Gnome for the PaperWM extension.
# Designed for submitting a zip to extensions.gnome.org.
zip -r paperwm@paperwm.github.com.zip \
	metadata.json \
	stylesheet.css \
	*.js \
	config/user.js \
	config/user.css \
	*.ui \
	LICENSE \
	schemas/gschemas.compiled \
	schemas/org.gnome.shell.extensions.paperwm.gschema.xml \
	resources/
