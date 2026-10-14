# The launch film's 3D shots, built and rendered by Blender from the command line:
#   blender -b -P scene.py
# A low-poly house at night, seen the way a PS1 would draw it: 480x270, no anti-aliasing, flat shading, fog, 15 frames a second.
# Shot A (frames 1-90): walking up the road towards the house. Shot B (frames 101-175): someone under the street lamp, then the lamp dies.
import bpy, math, os, random
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frames")
random.seed(11)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        pass
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 480, 270, 100
sc.render.fps = 15
sc.render.image_settings.file_format = "PNG"
sc.render.filter_size = 0.01
try:
    sc.eevee.taa_render_samples = 1
    sc.eevee.use_volumetric_shadows = False
except Exception:
    pass
sc.view_settings.view_transform = "Standard"
try:
    sc.view_settings.look = "High Contrast"
except Exception:
    pass

world = bpy.data.worlds.new("Night")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.006, 0.010, 0.022, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0


def mat(name, rgb, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = 1.0
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


M = {
    "ground": mat("ground", (0.020, 0.045, 0.028)), "road": mat("road", (0.022, 0.024, 0.028)), "line": mat("line", (0.20, 0.19, 0.10)),
    "wall": mat("wall", (0.16, 0.13, 0.10)), "roof": mat("roof", (0.030, 0.028, 0.032)), "door": mat("door", (0.020, 0.014, 0.010)),
    "window": mat("window", (0.92, 0.72, 0.30), 6.0), "dark": mat("dark", (0.010, 0.012, 0.016)), "post": mat("post", (0.03, 0.035, 0.04)),
    "bulb": mat("bulb", (1.0, 0.86, 0.55), 12.0), "tree": mat("tree", (0.016, 0.050, 0.030)), "trunk": mat("trunk", (0.030, 0.020, 0.012)),
    "hoodie": mat("hoodie", (0.035, 0.038, 0.048)), "jeans": mat("jeans", (0.030, 0.042, 0.075)), "skin": mat("skin", (0.42, 0.31, 0.25)),
    "shoe": mat("shoe", (0.012, 0.012, 0.014)), "eye": mat("eye", (0.004, 0.004, 0.005)),
}


def box(name, size, loc, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.data.materials.append(M[m])
    return o


def cone(name, r, h, loc, m, verts=5, rot=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, depth=h, location=loc, rotation=(0, 0, rot))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(M[m])
    return o


# Blender is Z-up: x right, y away from the camera, z up
box("Ground", (160, 160, 0.02), (0, 30, -0.01), "ground")
box("Road", (5, 120, 0.04), (0, 20, 0.02), "road")
for i in range(16):
    box("Line.%02d" % i, (0.18, 1.6, 0.05), (0, -12 + i * 6, 0.05), "line")
box("House", (7, 5.5, 3.4), (7.5, 14, 1.7), "wall")
cone("Roof", 5.6, 2.6, (7.5, 14, 4.7), "roof", verts=4, rot=math.pi / 4)
box("Door", (1.2, 0.1, 2.1), (6.4, 11.2, 1.05), "door")
box("Window.lit", (1.3, 0.1, 1.1), (9.2, 11.2, 2.0), "window")
box("Window.dark", (1.3, 0.1, 1.1), (4.7, 11.2, 2.0), "dark")
box("LampPost", (0.14, 0.14, 5), (-3.2, 6, 2.5), "post")
box("LampArm", (1.2, 0.14, 0.1), (-2.7, 6, 5), "post")
bulb = box("LampBulb", (0.4, 0.3, 0.14), (-2.2, 6, 4.92), "bulb")
for i in range(110):
    side = -1 if random.random() < 0.5 else 1
    x, y = side * (5 + random.random() * 30), -14 + random.random() * 75
    if 2 < x < 13 and 9 < y < 19:
        continue
    h = 3 + random.random() * 4.5
    cone("Tree.%03d" % i, 1 + random.random() * 0.9, h, (x, y, h / 2 + 0.7), "tree")
    box("Trunk.%03d" % i, (0.26, 0.26, 1.4), (x, y, 0.7), "trunk")


def limb(name, r1, r2, h, loc, m, verts=6, rot=(0.0, 0.0, 0.0)):
    """A tapered low-poly tube: wide end down. Six sides, flat shaded, like a PS1 limb."""
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(M[m])
    return o


def person(x, y, facing=math.pi):
    """A man in a hooded jacket, about 1.8 m, standing still with his head slightly down.
    Human proportions on purpose: these games frighten with ordinary people, not monsters. Returns every part."""
    parts = []
    add = parts.append
    for s in (-1, 1):
        add(box("Man.shoe", (0.11, 0.27, 0.09), (x + s * 0.10, y - 0.04, 0.045), "shoe"))
        add(limb("Man.shin", 0.062, 0.075, 0.46, (x + s * 0.10, y, 0.32), "jeans"))
        add(limb("Man.thigh", 0.078, 0.098, 0.46, (x + s * 0.10, y, 0.78), "jeans"))
        # arms hang a little away from the body, elbows barely bent
        add(limb("Man.upperarm", 0.058, 0.068, 0.34, (x + s * 0.265, y, 1.33), "hoodie", rot=(0, s * -0.10, 0)))
        add(limb("Man.forearm", 0.048, 0.058, 0.30, (x + s * 0.295, y - 0.02, 1.03), "hoodie", rot=(0.12, s * -0.04, 0)))
        add(box("Man.hand", (0.07, 0.05, 0.11), (x + s * 0.30, y - 0.04, 0.83), "skin"))
    add(box("Man.hips", (0.34, 0.20, 0.20), (x, y, 1.02), "jeans"))
    belly = limb("Man.belly", 0.19, 0.20, 0.30, (x, y, 1.20), "hoodie", verts=8)
    belly.scale = (1, 0.62, 1)
    add(belly)
    chest = limb("Man.chest", 0.20, 0.235, 0.34, (x, y, 1.46), "hoodie", verts=8)
    chest.scale = (1, 0.6, 1)
    add(chest)
    add(box("Man.shoulders", (0.52, 0.19, 0.09), (x, y, 1.60), "hoodie"))
    add(limb("Man.neck", 0.055, 0.05, 0.08, (x, y - 0.01, 1.67), "skin"))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.5, location=(x, y - 0.035, 1.80))
    head = bpy.context.active_object
    head.name = "Man.head"
    head.scale = (0.19, 0.21, 0.25)
    head.rotation_euler = (0.22, 0, 0)  # looking down
    head.data.materials.append(M["skin"])
    add(head)
    # the hood sits back off the face, so the face stays in its shadow
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.5, location=(x, y + 0.045, 1.815))
    hood = bpy.context.active_object
    hood.name = "Man.hood"
    hood.scale = (0.26, 0.26, 0.30)
    hood.data.materials.append(M["hoodie"])
    add(hood)
    add(box("Man.hoodbrim", (0.24, 0.10, 0.05), (x, y - 0.09, 1.935), "hoodie"))
    for s in (-1, 1):
        add(box("Man.eye", (0.028, 0.02, 0.016), (x + s * 0.042, y - 0.137, 1.80), "eye"))
    return parts


fig = person(-1.5, 7.3)

# fog: a thin volume over everything, so distance swallows detail
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 25, 10))
fog = bpy.context.active_object
fog.name = "Fog"
fog.scale = (140, 140, 30)
fm = bpy.data.materials.new("fog")
fm.use_nodes = True
nt = fm.node_tree
nt.nodes.clear()
vol = nt.nodes.new("ShaderNodeVolumePrincipled")
vol.inputs["Density"].default_value = 0.035
vol.inputs["Color"].default_value = (0.35, 0.42, 0.6, 1)
outn = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(vol.outputs["Volume"], outn.inputs["Volume"])
fog.data.materials.append(fm)


def light(name, kind, loc, energy, color, **kw):
    d = bpy.data.lights.new(name, kind)
    d.energy, d.color = energy, color
    for k, v in kw.items():
        setattr(d, k, v)
    o = bpy.data.objects.new(name, d)
    o.location = loc
    sc.collection.objects.link(o)
    return o


moon = light("Moon", "SUN", (0, 0, 20), 0.35, (0.55, 0.65, 1.0))
moon.rotation_euler = (math.radians(50), 0, math.radians(-30))
lamp = light("Lamp", "POINT", (-2.2, 6, 4.6), 900, (1.0, 0.85, 0.55), shadow_soft_size=0.3)
win = light("WindowGlow", "POINT", (9.2, 10.4, 2.0), 260, (0.95, 0.75, 0.35), shadow_soft_size=0.5)


def key(obj, path, frame, value):
    setattr(obj, path, value)
    obj.keyframe_insert(path, frame=frame)


# the street lamp is failing: short dropouts, then it dies for good at the end of shot B
for f in range(1, 176):
    on = 1.0
    if f in (22, 23, 51, 64, 65, 118, 119, 131) or f >= 160:
        on = 0.06
    key(lamp.data, "energy", f, 900 * on)
bulb_mat = M["bulb"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
for f in range(1, 176):
    bulb_mat.default_value = 12.0 if not (f in (22, 23, 51, 64, 65, 118, 119, 131) or f >= 160) else 0.3
    bulb_mat.keyframe_insert("default_value", frame=f)
# the figure is only there in shot B
for o in fig:
    for f, hide in ((1, True), (100, True), (101, False), (175, False)):
        o.hide_render = hide
        o.keyframe_insert("hide_render", frame=f)


def camera(name, lens):
    d = bpy.data.cameras.new(name)
    d.lens = lens
    d.clip_end = 300
    o = bpy.data.objects.new(name, d)
    sc.collection.objects.link(o)
    t = bpy.data.objects.new(name + ".target", None)
    sc.collection.objects.link(t)
    c = o.constraints.new("TRACK_TO")
    c.target, c.track_axis, c.up_axis = t, "TRACK_NEGATIVE_Z", "UP_Y"
    return o, t


def shake(obj, base, f, amount):
    # a hand holding the camera: a small new offset every third frame
    j = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))) * amount
    obj.location = Vector(base) + j
    obj.keyframe_insert("location", frame=f)


camA, tgtA = camera("CamA", 24)
for f in range(1, 91, 3):
    k = (f - 1) / 89
    step = abs(math.sin(k * math.pi * 9)) * 0.07  # footsteps
    shake(camA, (-0.6 + k * 2.6, -8.5 + k * 9.5, 1.72 + step), f, 0.015)
    shake(tgtA, (4.5 + k * 2.2, 12, 1.9), f, 0.05)
camB, tgtB = camera("CamB", 58)
for f in range(101, 176, 3):
    k = (f - 101) / 74
    shake(camB, (3.4 - k * 0.5, -3.6 + k * 1.8, 1.66), f, 0.012)
    shake(tgtB, (-1.9, 7.0, 1.9), f, 0.04)

for name, cam, a, b in [s for s in (("shotA", camA, 1, 90), ("shotB", camB, 101, 175)) if os.environ.get("ONLY", s[0]) == s[0]]:
    sc.camera = cam
    sc.frame_start, sc.frame_end = a, b
    sc.render.filepath = os.path.join(OUT, name, "f_")
    bpy.ops.render.render(animation=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(OUT), "lastseen-night.blend"))
print("RENDER DONE")
