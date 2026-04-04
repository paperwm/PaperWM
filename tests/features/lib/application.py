class GTKWidgetBuilder:
    """ A Gtk widget node in the gtk-stream format that can accept children.
    """

    def __init__(self, widget, id, children = None, **kwargs):
        kw_merged = " ".join(f'{k}="{v}"' for k, v in kwargs.items())
        self._kind = widget
        self._output = f'<{widget} id="{id}" {kw_merged}>\n'
        self._finished = False
        if children is not None:
            for child in children:
                self.add(child)


    def add(self, child):
        self._output += child.finish()

    def finish(self):
        self._output += f"</{self._kind}>\n"
        self._finished = True
        return self._output

class GTKApplication:
    """ A remote-controlled Gtk application using gtk-stream.
    """

    def __init__(self, nixos, id, use_x11 = False, scratch = False):
        self._id = id
        self._nixos = nixos
        self._kind = "x11" if use_x11 else "wayland"
        self._fqid = f'com.github.paperwm.{"scratch_app" if scratch else "app"}_{id}'
        nixos.machine.succeed(f"""
            sudo -u user DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user start gtk-stream-{self._kind}@{self._id}.service
        """)
        self._send(f'<application application_id="{self._fqid}">')

    def _send(self, data):
        self._nixos.machine.succeed(f"cat > /tmp/app_{self._id} <<EOF\n{data}\nEOF")

    def add(self, child: GTKWidgetBuilder):
        self._send(child.finish())

    def close_window(self, winid):
        self._send(f'<close-window id="{winid}"/>')

    def exit(self):
        self._send(f'</application>')
        self._nixos.machine.succeed(f"""
            sudo -u user DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user stop gtk-stream-{self._kind}@{self._id}.service
        """)
