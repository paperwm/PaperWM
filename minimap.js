if(window.minimap) {
    minimap.destroy();
//: t
}

St = imports.gi.St;
Clutter = imports.gi.Clutter;
WorkspaceThumbnail = imports.ui.workspaceThumbnail;

minimap = new St.Bin();
minimap.set_style_class_name("minimap");

Main.uiGroup.add_actor(minimap);

ws = global.screen.get_active_workspace();

miniws = new WorkspaceThumbnail.WorkspaceThumbnail(ws);

scale = 0.25;

minimap.set_scale(scale, scale);

monitor_g = global.screen.get_monitor_geometry(0);

clip_w = monitor_g.width/scale;

miniws_w = miniws.actor.get_width();

minimap.set_child(miniws.actor);
miniws.actor.set_clip(-(clip_w-miniws_w)/2, 0, clip_w, miniws.actor.get_height());

minimap.set_width(monitor_g.width/scale);

minimap.set_position(0, monitor_g.height - minimap.get_transformed_size()[1]);


minimap.get_s

minimap.get_size()
//: [0,0]
miniws.actor.get_size()
//: [800,600]
